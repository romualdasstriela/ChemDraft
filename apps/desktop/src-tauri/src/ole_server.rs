//! The "ChemDraft Drawing" object Office documents embed (Windows only).
//!
//! Ctrl+C puts the drawing on the clipboard as an embeddable object: a small structured-storage
//! document ("Embed Source") holding the ChemDraft file and its picture, plus an "Object
//! Descriptor". Word pastes it as an object and shows the picture without starting ChemDraft.
//!
//! Double-clicking the object makes Word ask this process, through COM, for a running object of
//! our class (`DrawingFactory`, registered at start-up), load it from the document's storage, and
//! run its primary verb. The verb writes the drawing to a temporary `.chemdraft` file and opens it
//! like any double-clicked file. Saving that file in ChemDraft (`embedding_saved`) hands the new
//! drawing and picture back: the object asks Word to save it (`IOleClientSite::SaveObject`), Word
//! stores it through `IPersistStorage::Save`, and the data-change notice makes Word refresh the
//! picture through `IDataObject::GetData`.
//!
//! COM calls arrive on the main thread (an STA running the window message loop); everything that
//! touches COM objects runs there too.

use std::cell::RefCell;
use std::collections::HashSet;
use std::mem::ManuallyDrop;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use windows::core::{
    implement, IUnknown, IUnknownImpl, Interface, Ref, Result, BOOL, GUID, HRESULT, PCWSTR, PWSTR,
};
use windows::Win32::Foundation::{
    CLASS_E_NOAGGREGATION, DV_E_FORMATETC, E_FAIL, E_NOTIMPL, HGLOBAL, HWND,
    OLE_E_ADVISENOTSUPPORTED, RECT, SIZE, S_FALSE, S_OK,
};
use windows::Win32::Graphics::Gdi::{
    DeleteEnhMetaFile, GetDC, GetWinMetaFileBits, ReleaseDC, SetEnhMetaFileBits, SetMetaFileBitsEx,
    HENHMETAFILE, LOGPALETTE,
};
use windows::Win32::System::Com::StructuredStorage::{
    CreateILockBytesOnHGlobal, GetHGlobalFromILockBytes, IPersistStorage, IPersistStorage_Impl,
    IStorage, ReadClassStg, StgCreateDocfileOnILockBytes, WriteClassStg, WriteFmtUserTypeStg,
};
use windows::Win32::System::Com::{
    CoInitializeEx, CoRegisterClassObject, CreateDataAdviseHolder, IAdviseSink, IClassFactory,
    IClassFactory_Impl, IDataAdviseHolder, IDataObject, IDataObject_Impl, IEnumFORMATETC,
    IEnumSTATDATA, IMoniker, IPersist_Impl, IStream, CLSCTX_LOCAL_SERVER, COINIT_APARTMENTTHREADED,
    COINIT_MULTITHREADED, DVASPECT, DVASPECT_CONTENT, FORMATETC, REGCLS_MULTIPLEUSE,
    STATFLAG_NONAME, STATSTG, STGMEDIUM, STGMEDIUM_0, STGM_CREATE, STGM_READ, STGM_READWRITE,
    STGM_SHARE_EXCLUSIVE, TYMED_ENHMF, TYMED_MFPICT,
};
use windows::Win32::System::DataExchange::{RegisterClipboardFormatW, METAFILEPICT};
use windows::Win32::System::Memory::{
    GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE,
};
use windows::Win32::System::Ole::{
    CreateOleAdviseHolder, IEnumOLEVERB, IOleAdviseHolder, IOleClientSite, IOleObject,
    IOleObject_Impl, OleRegEnumFormatEtc, OleRegEnumVerbs, OleRegGetUserType, OLECLOSE,
    OLEGETMONIKER, OLEIVERB_HIDE, OLEMISC, OLEWHICHMK, USERCLASSTYPE,
};
use windows::Win32::UI::WindowsAndMessaging::MSG;

use crate::ole_registration::{self, OleClass};
use crate::NativeOpenDocumentPayload;

/// The structured-storage stream holding the ChemDraft file (UTF-8).
const DOCUMENT_STREAM: &str = "ChemDraftDocument";
/// The stream holding the drawing's picture (an Enhanced Metafile).
const PICTURE_STREAM: &str = "ChemDraftPicture";
const CF_ENHMETAFILE: u16 = 14;
const CF_METAFILEPICT: u16 = 3;
const MM_ANISOTROPIC: i32 = 8;

struct Server {
    app: tauri::AppHandle,
    class: OleClass,
    clsid: GUID,
}

static SERVER: OnceLock<Server> = OnceLock::new();
/// Temporary files of drawings open for editing (lower-cased paths), readable from any thread.
static EDITING_PATHS: Mutex<Option<HashSet<String>>> = Mutex::new(None);
static NEXT_EDIT: AtomicU64 = AtomicU64::new(1);

thread_local! {
    /// Drawings open for editing, by temporary file (main thread only, like every COM object here).
    static OPEN_DRAWINGS: RefCell<Vec<OpenDrawing>> = const { RefCell::new(Vec::new()) };
}

struct OpenDrawing {
    path_key: String,
    state: Rc<RefCell<DrawingState>>,
    data_object: IDataObject,
}

fn path_key(path: &Path) -> String {
    path.to_string_lossy().to_lowercase()
}

fn guid_from_class(class: &OleClass) -> Option<GUID> {
    let bytes = ole_registration::class_id_bytes(class.class_id)?;
    Some(GUID::from_values(
        u32::from_le_bytes(bytes[0..4].try_into().ok()?),
        u16::from_le_bytes(bytes[4..6].try_into().ok()?),
        u16::from_le_bytes(bytes[6..8].try_into().ok()?),
        bytes[8..16].try_into().ok()?,
    ))
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Register the class for this user and offer its factory to COM. Call once, on the main thread,
/// during setup. Failures are logged: copying and pasting pictures still works without them.
pub(crate) fn start(app: &tauri::AppHandle) {
    let class = ole_registration::ole_class_for_identifier(&app.config().identifier);
    let Some(clsid) = guid_from_class(&class) else {
        eprintln!("ChemDraft: invalid embedding class id {}", class.class_id);
        return;
    };
    match std::env::current_exe() {
        Ok(exe) => {
            let entries = ole_registration::registry_entries(&class, &exe.to_string_lossy());
            let failed = ole_registration::native::write_registry_entries(&entries);
            if !failed.is_empty() {
                eprintln!(
                    "ChemDraft: could not register the embedding class: {}",
                    failed.join(", ")
                );
            }
        }
        Err(error) => eprintln!("ChemDraft: no executable path for the embedding class: {error}"),
    }
    if SERVER
        .set(Server {
            app: app.clone(),
            class,
            clsid,
        })
        .is_err()
    {
        return;
    }
    // SAFETY: COM initialisation on the main thread (already an STA when the windowing layer set it
    // up; then this only adds a reference), and registering a factory object that COM keeps alive.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let factory: IClassFactory = DrawingFactory.into();
        match CoRegisterClassObject(&clsid, &factory, CLSCTX_LOCAL_SERVER, REGCLS_MULTIPLEUSE) {
            // The registration lives as long as the process; COM revokes it at exit.
            Ok(_cookie) => log("class offered to COM"),
            Err(error) => log(&format!("could not offer the class to COM: {error}")),
        }
    }
}

/// The clipboard's "Embed Source" (a structured-storage document holding the drawing and its
/// picture) and "Object Descriptor" for a Ctrl+C, or `None` when the class is not running.
pub(crate) fn clipboard_embedding(document: &str, emf: &[u8]) -> Option<(Vec<u8>, Vec<u8>)> {
    let server = SERVER.get()?;
    // The clipboard write runs on a worker thread; structured storage needs COM there too.
    // SAFETY: plain COM initialisation of the calling thread.
    let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    let storage = match storage_bytes(&server.clsid, &server.class, document, emf) {
        Ok(bytes) => bytes,
        Err(error) => {
            eprintln!("ChemDraft: could not build the embedded drawing: {error}");
            return None;
        }
    };
    let class_bytes = ole_registration::class_id_bytes(server.class.class_id)?;
    let size = ole_registration::emf_frame_himetric(emf).unwrap_or((0, 0));
    let descriptor = ole_registration::object_descriptor_bytes(
        class_bytes,
        size,
        server.class.user_type,
        server.class.short_name,
    );
    log(&format!(
        "clipboard embedding: {} bytes of storage",
        storage.len()
    ));
    Some((storage, descriptor))
}

/// A saved file: if it is the temporary copy of a drawing open for editing, hand the drawing and
/// its picture back to the Office document. Returns whether it was one.
pub(crate) fn embedding_saved(path: &str, emf: Option<Vec<u8>>) -> bool {
    let key = path_key(Path::new(path));
    let editing = EDITING_PATHS
        .lock()
        .map(|paths| paths.as_ref().is_some_and(|paths| paths.contains(&key)))
        .unwrap_or(false);
    let Some(server) = SERVER.get() else {
        return false;
    };
    if !editing {
        if path.contains("ChemDraft Office drawings") {
            log(&format!(
                "saved {path}: not a drawing open for editing (key {key})"
            ));
        }
        return false;
    }
    let contents = match std::fs::read(path) {
        Ok(bytes) => crate::decode_document_text(&bytes),
        Err(error) => {
            eprintln!("ChemDraft: could not read the saved embedded drawing: {error}");
            return false;
        }
    };
    log(&format!(
        "saved {path}: handing it back to the Office document"
    ));
    // The save arrives inside the webview's message callback, where Windows refuses calls out to
    // another program (RPC_E_CANTCALLOUT_ININPUTSYNCCALL), so Office never heard of the save. Queue
    // the hand-back from another thread: it then runs from the event loop, outside any callback.
    let app = server.app.clone();
    let queued =
        std::thread::spawn(move || app.run_on_main_thread(move || hand_back(&key, contents, emf)))
            .join()
            .map(|result| result.is_ok())
            .unwrap_or(false);
    if !queued {
        log("could not queue the hand-back on the main thread");
    }
    queued
}

/// On the main thread: store the saved drawing in its object and tell the container.
fn hand_back(key: &str, contents: String, emf: Option<Vec<u8>>) {
    {
        let found = OPEN_DRAWINGS.with(|drawings| {
            drawings
                .borrow()
                .iter()
                .find(|drawing| drawing.path_key == key)
                .map(|drawing| (drawing.state.clone(), drawing.data_object.clone()))
        });
        let Some((state, data_object)) = found else {
            log("hand-back: the drawing is no longer open for editing");
            return;
        };
        {
            let mut state = state.borrow_mut();
            state.document = contents;
            if let Some(emf) = emf.filter(|bytes| !bytes.is_empty()) {
                if let Some(size) = ole_registration::emf_frame_himetric(&emf) {
                    state.extent = SIZE {
                        cx: size.0,
                        cy: size.1,
                    };
                }
                state.picture = emf;
            }
            state.dirty = true;
        }
        notify_saved(&state, &data_object);
    }
}

/// Tell the container the drawing changed: save it, refresh its picture.
fn notify_saved(state: &Rc<RefCell<DrawingState>>, data_object: &IDataObject) {
    let (site, data_advise, ole_advise) = {
        let state = state.borrow();
        (
            state.client_site.clone(),
            state.data_advise.clone(),
            state.ole_advise.clone(),
        )
    };
    // SAFETY: COM calls on the main thread with live interface pointers; the container may call
    // back into this object (Save, GetData) during them, which only borrows its state briefly.
    unsafe {
        match site {
            Some(site) => log(&format!("SaveObject: {:?}", site.SaveObject())),
            None => log("hand-back: no client site to save through"),
        }
        match data_advise {
            Some(holder) => log(&format!(
                "SendOnDataChange: {:?}",
                holder.SendOnDataChange(data_object, None, 0)
            )),
            None => log("hand-back: nobody asked for data changes"),
        }
        if let Some(holder) = ole_advise {
            log(&format!("SendOnSave: {:?}", holder.SendOnSave()));
        }
    }
}

/// Append one line to `%TEMP%\ChemDraft Office drawings\ole-log.txt`, the trace of the embedding
/// round trip (a GUI app has no console). The log restarts once it passes 256 KB.
fn log(message: &str) {
    use std::io::Write;
    let folder = std::env::temp_dir().join("ChemDraft Office drawings");
    if std::fs::create_dir_all(&folder).is_err() {
        return;
    }
    let path = folder.join("ole-log.txt");
    let restart = std::fs::metadata(&path).is_ok_and(|meta| meta.len() > 256 * 1024);
    let file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(!restart)
        .truncate(restart)
        .open(&path);
    if let Ok(mut file) = file {
        let seconds = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_secs_f64())
            .unwrap_or(0.0);
        let _ = writeln!(file, "{seconds:.3} [{}] {message}", std::process::id());
    }
}

fn storage_bytes(clsid: &GUID, class: &OleClass, document: &str, emf: &[u8]) -> Result<Vec<u8>> {
    // SAFETY: an in-memory docfile on an HGLOBAL this function owns until it copies the bytes out.
    unsafe {
        let lock_bytes = CreateILockBytesOnHGlobal(None, true)?;
        let storage = StgCreateDocfileOnILockBytes(
            &lock_bytes,
            STGM_CREATE | STGM_READWRITE | STGM_SHARE_EXCLUSIVE,
            0,
        )?;
        write_storage(&storage, clsid, class, document.as_bytes(), emf)?;
        storage.Commit(0)?;
        drop(storage);
        let mut stat = STATSTG::default();
        lock_bytes.Stat(&mut stat, STATFLAG_NONAME.0 as u32)?;
        let hglobal = GetHGlobalFromILockBytes(&lock_bytes)?;
        let length = (stat.cbSize as usize).min(GlobalSize(hglobal));
        let pointer = GlobalLock(hglobal) as *const u8;
        if pointer.is_null() {
            return Err(E_FAIL.into());
        }
        let bytes = std::slice::from_raw_parts(pointer, length).to_vec();
        let _ = GlobalUnlock(hglobal);
        Ok(bytes)
    }
}

/// Write the class, the user type, the drawing and its picture into `storage`.
unsafe fn write_storage(
    storage: &IStorage,
    clsid: &GUID,
    class: &OleClass,
    document: &[u8],
    emf: &[u8],
) -> Result<()> {
    WriteClassStg(storage, clsid)?;
    let user_type = wide(class.user_type);
    let format = RegisterClipboardFormatW(PCWSTR(user_type.as_ptr())) as u16;
    WriteFmtUserTypeStg(storage, format, PCWSTR(user_type.as_ptr()))?;
    write_stream(storage, DOCUMENT_STREAM, document)?;
    write_stream(storage, PICTURE_STREAM, emf)?;
    Ok(())
}

unsafe fn write_stream(storage: &IStorage, name: &str, bytes: &[u8]) -> Result<()> {
    let name = wide(name);
    let stream = storage.CreateStream(
        PCWSTR(name.as_ptr()),
        STGM_CREATE | STGM_READWRITE | STGM_SHARE_EXCLUSIVE,
        0,
        0,
    )?;
    let mut written = 0u32;
    stream
        .Write(
            bytes.as_ptr().cast(),
            bytes.len() as u32,
            Some(&mut written),
        )
        .ok()?;
    if written as usize != bytes.len() {
        return Err(E_FAIL.into());
    }
    Ok(())
}

unsafe fn read_stream(storage: &IStorage, name: &str) -> Result<Vec<u8>> {
    let name = wide(name);
    let stream: IStream = storage.OpenStream(
        PCWSTR(name.as_ptr()),
        None,
        STGM_READ | STGM_SHARE_EXCLUSIVE,
        0,
    )?;
    let mut stat = STATSTG::default();
    stream.Stat(&mut stat, STATFLAG_NONAME)?;
    // A drawing far beyond any real page is not one: refuse rather than allocate it.
    if stat.cbSize > 256 * 1024 * 1024 {
        return Err(E_FAIL.into());
    }
    let mut bytes = vec![0u8; stat.cbSize as usize];
    let mut read = 0u32;
    stream
        .Read(
            bytes.as_mut_ptr().cast(),
            bytes.len() as u32,
            Some(&mut read),
        )
        .ok()?;
    bytes.truncate(read as usize);
    Ok(bytes)
}

// ---------------------------------------------------------------------------------------------
// The class factory

#[implement(IClassFactory)]
struct DrawingFactory;

impl IClassFactory_Impl for DrawingFactory_Impl {
    fn CreateInstance(
        &self,
        punkouter: Ref<'_, IUnknown>,
        riid: *const GUID,
        ppvobject: *mut *mut core::ffi::c_void,
    ) -> Result<()> {
        if !punkouter.is_null() {
            return Err(CLASS_E_NOAGGREGATION.into());
        }
        let unknown: IUnknown = Drawing::new().into();
        // SAFETY: COM hands valid out pointers; `query` AddRefs what it returns.
        unsafe { unknown.query(riid, ppvobject).ok() }
    }

    fn LockServer(&self, _flock: BOOL) -> Result<()> {
        Ok(())
    }
}

// ---------------------------------------------------------------------------------------------
// The drawing object

struct DrawingState {
    client_site: Option<IOleClientSite>,
    ole_advise: Option<IOleAdviseHolder>,
    data_advise: Option<IDataAdviseHolder>,
    /// The ChemDraft file (UTF-8 text).
    document: String,
    /// The picture, an Enhanced Metafile.
    picture: Vec<u8>,
    /// The picture's size in HIMETRIC (0.01 mm).
    extent: SIZE,
    /// The container's name for the object ("Document1"), used for the temporary file's name.
    container_object: String,
    temp_path: Option<PathBuf>,
    dirty: bool,
}

#[implement(IOleObject, IDataObject, IPersistStorage)]
struct Drawing {
    state: Rc<RefCell<DrawingState>>,
}

impl Drawing {
    fn new() -> Self {
        Self {
            state: Rc::new(RefCell::new(DrawingState {
                client_site: None,
                ole_advise: None,
                data_advise: None,
                document: String::new(),
                picture: Vec::new(),
                extent: SIZE { cx: 0, cy: 0 },
                container_object: String::new(),
                temp_path: None,
                dirty: false,
            })),
        }
    }
}

fn server() -> Result<&'static Server> {
    SERVER.get().ok_or_else(|| E_FAIL.into())
}

/// A file name from the container's name for the object: letters, digits, spaces, dots, dashes.
fn temporary_file_name(container_object: &str) -> String {
    let cleaned: String = container_object
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let cleaned = cleaned.trim().trim_end_matches('.');
    if cleaned.is_empty() {
        "Drawing from Office.chemdraft".to_string()
    } else {
        format!("Drawing in {cleaned}.chemdraft")
    }
}

impl Drawing_Impl {
    /// Write the drawing to its temporary file and open it in ChemDraft.
    fn open_for_editing(&self) -> Result<()> {
        let server = server()?;
        let (document, path) = {
            let mut state = self.state.borrow_mut();
            if state.document.trim().is_empty() {
                return Err(E_FAIL.into());
            }
            let path = match &state.temp_path {
                Some(path) => path.clone(),
                None => {
                    let folder =
                        std::env::temp_dir()
                            .join("ChemDraft Office drawings")
                            .join(format!(
                                "{}-{}",
                                std::process::id(),
                                NEXT_EDIT.fetch_add(1, Ordering::SeqCst)
                            ));
                    std::fs::create_dir_all(&folder)
                        .map_err(|_| windows::core::Error::from(E_FAIL))?;
                    let path = folder.join(temporary_file_name(&state.container_object));
                    state.temp_path = Some(path.clone());
                    path
                }
            };
            (state.document.clone(), path)
        };
        std::fs::write(&path, document.as_bytes())
            .map_err(|_| windows::core::Error::from(E_FAIL))?;

        let key = path_key(&path);
        if let Ok(mut paths) = EDITING_PATHS.lock() {
            paths.get_or_insert_with(HashSet::new).insert(key.clone());
        }
        let data_object: IDataObject = self.to_interface();
        OPEN_DRAWINGS.with(|drawings| {
            let mut drawings = drawings.borrow_mut();
            drawings.retain(|drawing| drawing.path_key != key);
            drawings.push(OpenDrawing {
                path_key: key,
                state: self.state.clone(),
                data_object,
            });
        });

        let display_name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "Drawing.chemdraft".to_string());
        let payload = NativeOpenDocumentPayload {
            path: path.to_string_lossy().into_owned(),
            display_name,
            contents: document,
        };
        if let Err(error) = crate::deliver_opened_document(&server.app, payload) {
            eprintln!("ChemDraft: could not open the embedded drawing: {error}");
            return Err(E_FAIL.into());
        }
        let site = self.state.borrow().client_site.clone();
        if let Some(site) = site {
            // SAFETY: COM calls on the main thread; failures only affect the container's display.
            unsafe {
                let _ = site.ShowObject();
                let _ = site.OnShowWindow(true);
            }
        }
        Ok(())
    }

    fn forget_editing(&self) {
        let path = self.state.borrow().temp_path.clone();
        if let Some(path) = path {
            let key = path_key(&path);
            if let Ok(mut paths) = EDITING_PATHS.lock() {
                if let Some(paths) = paths.as_mut() {
                    paths.remove(&key);
                }
            }
            OPEN_DRAWINGS.with(|drawings| {
                drawings
                    .borrow_mut()
                    .retain(|drawing| drawing.path_key != key)
            });
        }
    }

    fn picture_handle(&self) -> Option<HENHMETAFILE> {
        let state = self.state.borrow();
        if state.picture.is_empty() {
            return None;
        }
        // SAFETY: the bytes are copied into a new metafile handle the caller owns.
        let handle = unsafe { SetEnhMetaFileBits(&state.picture) };
        (!handle.is_invalid()).then_some(handle)
    }
}

fn format_supported(format: &FORMATETC) -> Option<u16> {
    if format.dwAspect != DVASPECT_CONTENT.0 {
        return None;
    }
    match format.cfFormat {
        CF_ENHMETAFILE if format.tymed & TYMED_ENHMF.0 as u32 != 0 => Some(CF_ENHMETAFILE),
        CF_METAFILEPICT if format.tymed & TYMED_MFPICT.0 as u32 != 0 => Some(CF_METAFILEPICT),
        _ => None,
    }
}

impl IOleObject_Impl for Drawing_Impl {
    fn SetClientSite(&self, pclientsite: Ref<'_, IOleClientSite>) -> Result<()> {
        log(&format!("SetClientSite (site: {})", !pclientsite.is_null()));
        self.state.borrow_mut().client_site = pclientsite.cloned();
        Ok(())
    }

    fn GetClientSite(&self) -> Result<IOleClientSite> {
        self.state
            .borrow()
            .client_site
            .clone()
            .ok_or_else(|| E_FAIL.into())
    }

    fn SetHostNames(&self, _szcontainerapp: &PCWSTR, szcontainerobj: &PCWSTR) -> Result<()> {
        if !szcontainerobj.is_null() {
            // SAFETY: COM passes a NUL-terminated string valid for this call.
            let name = unsafe { szcontainerobj.to_string() }.unwrap_or_default();
            self.state.borrow_mut().container_object = name;
        }
        Ok(())
    }

    fn Close(&self, _dwsaveoption: &OLECLOSE) -> Result<()> {
        log("Close");
        let (holder, site) = {
            let state = self.state.borrow();
            (state.ole_advise.clone(), state.client_site.clone())
        };
        // SAFETY: COM calls on the main thread.
        unsafe {
            if let Some(site) = site {
                let _ = site.OnShowWindow(false);
            }
            if let Some(holder) = holder {
                let _ = holder.SendOnClose();
            }
        }
        self.forget_editing();
        Ok(())
    }

    fn SetMoniker(&self, _dwwhichmoniker: &OLEWHICHMK, _pmk: Ref<'_, IMoniker>) -> Result<()> {
        Ok(())
    }

    fn GetMoniker(
        &self,
        _dwassign: &OLEGETMONIKER,
        _dwwhichmoniker: &OLEWHICHMK,
    ) -> Result<IMoniker> {
        Err(E_NOTIMPL.into())
    }

    fn InitFromData(
        &self,
        _pdataobject: Ref<'_, IDataObject>,
        _fcreation: BOOL,
        _dwreserved: u32,
    ) -> Result<()> {
        Err(E_NOTIMPL.into())
    }

    fn GetClipboardData(&self, _dwreserved: u32) -> Result<IDataObject> {
        Err(E_NOTIMPL.into())
    }

    fn DoVerb(
        &self,
        iverb: i32,
        _lpmsg: *const MSG,
        pactivesite: Ref<'_, IOleClientSite>,
        _lindex: i32,
        _hwndparent: HWND,
        _lprcposrect: *const RECT,
    ) -> Result<()> {
        log(&format!("DoVerb {iverb}"));
        if iverb == OLEIVERB_HIDE.0 {
            return Ok(());
        }
        if self.state.borrow().client_site.is_none() {
            self.state.borrow_mut().client_site = pactivesite.cloned();
        }
        // Every other verb (Edit, Open, Show, the primary verb) opens the drawing in ChemDraft.
        self.open_for_editing()
    }

    fn EnumVerbs(&self) -> Result<IEnumOLEVERB> {
        // SAFETY: reads the class's Verb keys from the registry.
        unsafe { OleRegEnumVerbs(&server()?.clsid) }
    }

    fn Update(&self) -> Result<()> {
        Ok(())
    }

    fn IsUpToDate(&self) -> Result<()> {
        Ok(())
    }

    fn GetUserClassID(&self) -> Result<GUID> {
        Ok(server()?.clsid)
    }

    fn GetUserType(&self, dwformoftype: &USERCLASSTYPE) -> Result<PWSTR> {
        // SAFETY: reads the class's names from the registry; the caller frees the string.
        unsafe { OleRegGetUserType(&server()?.clsid, *dwformoftype) }
    }

    fn SetExtent(&self, dwdrawaspect: DVASPECT, psizel: *const SIZE) -> Result<()> {
        if dwdrawaspect != DVASPECT_CONTENT || psizel.is_null() {
            return Err(E_FAIL.into());
        }
        // SAFETY: COM passes a valid SIZE pointer.
        self.state.borrow_mut().extent = unsafe { *psizel };
        Ok(())
    }

    fn GetExtent(&self, dwdrawaspect: DVASPECT) -> Result<SIZE> {
        if dwdrawaspect != DVASPECT_CONTENT {
            return Err(E_FAIL.into());
        }
        let state = self.state.borrow();
        if state.extent.cx > 0 && state.extent.cy > 0 {
            return Ok(state.extent);
        }
        ole_registration::emf_frame_himetric(&state.picture)
            .map(|(cx, cy)| SIZE { cx, cy })
            .ok_or_else(|| E_FAIL.into())
    }

    fn Advise(&self, padvsink: Ref<'_, IAdviseSink>) -> Result<u32> {
        log("Advise");
        let holder = {
            let mut state = self.state.borrow_mut();
            if state.ole_advise.is_none() {
                // SAFETY: creates a standard COM advise holder.
                state.ole_advise = Some(unsafe { CreateOleAdviseHolder()? });
            }
            state.ole_advise.clone()
        };
        let sink = padvsink.ok()?;
        // SAFETY: COM call with a live sink.
        unsafe {
            holder
                .ok_or_else(|| windows::core::Error::from(E_FAIL))?
                .Advise(sink)
        }
    }

    fn Unadvise(&self, dwconnection: u32) -> Result<()> {
        let holder = self.state.borrow().ole_advise.clone();
        // SAFETY: COM call.
        unsafe {
            holder
                .ok_or_else(|| windows::core::Error::from(E_FAIL))?
                .Unadvise(dwconnection)
        }
    }

    fn EnumAdvise(&self) -> Result<IEnumSTATDATA> {
        let holder = self.state.borrow().ole_advise.clone();
        // SAFETY: COM call.
        unsafe {
            holder
                .ok_or_else(|| windows::core::Error::from(E_FAIL))?
                .EnumAdvise()
        }
    }

    fn GetMiscStatus(&self, _dwaspect: DVASPECT) -> Result<OLEMISC> {
        Ok(OLEMISC(0))
    }

    fn SetColorScheme(&self, _plogpal: *const LOGPALETTE) -> Result<()> {
        Err(E_NOTIMPL.into())
    }
}

impl IDataObject_Impl for Drawing_Impl {
    fn GetData(&self, pformatetcin: *const FORMATETC) -> Result<STGMEDIUM> {
        if pformatetcin.is_null() {
            return Err(DV_E_FORMATETC.into());
        }
        // SAFETY: COM passes a valid FORMATETC.
        let format = unsafe { &*pformatetcin };
        log(&format!(
            "GetData format {} tymed {}",
            format.cfFormat, format.tymed
        ));
        match format_supported(format) {
            Some(CF_ENHMETAFILE) => {
                let handle = self
                    .picture_handle()
                    .ok_or_else(|| windows::core::Error::from(E_FAIL))?;
                Ok(STGMEDIUM {
                    tymed: TYMED_ENHMF.0 as u32,
                    u: STGMEDIUM_0 {
                        hEnhMetaFile: handle,
                    },
                    pUnkForRelease: ManuallyDrop::new(None),
                })
            }
            Some(CF_METAFILEPICT) => {
                let handle = self
                    .picture_handle()
                    .ok_or_else(|| windows::core::Error::from(E_FAIL))?;
                let extent = self
                    .GetExtent(DVASPECT_CONTENT)
                    .unwrap_or(SIZE { cx: 0, cy: 0 });
                let global = metafile_picture(handle, extent);
                // SAFETY: the handle was created above and is no longer needed.
                unsafe {
                    let _ = DeleteEnhMetaFile(Some(handle));
                }
                let global = global?;
                Ok(STGMEDIUM {
                    tymed: TYMED_MFPICT.0 as u32,
                    u: STGMEDIUM_0 {
                        hMetaFilePict: global.0,
                    },
                    pUnkForRelease: ManuallyDrop::new(None),
                })
            }
            _ => Err(DV_E_FORMATETC.into()),
        }
    }

    fn GetDataHere(&self, _pformatetc: *const FORMATETC, _pmedium: *mut STGMEDIUM) -> Result<()> {
        Err(E_NOTIMPL.into())
    }

    fn QueryGetData(&self, pformatetc: *const FORMATETC) -> HRESULT {
        if pformatetc.is_null() {
            return DV_E_FORMATETC;
        }
        // SAFETY: COM passes a valid FORMATETC.
        let format = unsafe { &*pformatetc };
        if format_supported(format).is_some() && !self.state.borrow().picture.is_empty() {
            S_OK
        } else {
            DV_E_FORMATETC
        }
    }

    fn GetCanonicalFormatEtc(
        &self,
        _pformatectin: *const FORMATETC,
        pformatetcout: *mut FORMATETC,
    ) -> HRESULT {
        if !pformatetcout.is_null() {
            // SAFETY: COM passes a writable FORMATETC; a null target device means "the same".
            unsafe { (*pformatetcout).ptd = std::ptr::null_mut() };
        }
        E_NOTIMPL
    }

    fn SetData(
        &self,
        _pformatetc: *const FORMATETC,
        _pmedium: *const STGMEDIUM,
        _frelease: BOOL,
    ) -> Result<()> {
        Err(E_NOTIMPL.into())
    }

    fn EnumFormatEtc(&self, dwdirection: u32) -> Result<IEnumFORMATETC> {
        // SAFETY: reads the class's DataFormats keys from the registry.
        unsafe { OleRegEnumFormatEtc(&server()?.clsid, dwdirection) }
    }

    fn DAdvise(
        &self,
        pformatetc: *const FORMATETC,
        advf: u32,
        padvsink: Ref<'_, IAdviseSink>,
    ) -> Result<u32> {
        log(&format!("DAdvise (advf {advf})"));
        let holder = {
            let mut state = self.state.borrow_mut();
            if state.data_advise.is_none() {
                // SAFETY: creates a standard COM data advise holder.
                state.data_advise = Some(unsafe { CreateDataAdviseHolder()? });
            }
            state.data_advise.clone()
        };
        let data_object: IDataObject = self.to_interface();
        let sink = padvsink.ok()?;
        // SAFETY: COM call with live interfaces.
        unsafe {
            holder
                .ok_or_else(|| windows::core::Error::from(E_FAIL))?
                .Advise(&data_object, pformatetc, advf, sink)
        }
    }

    fn DUnadvise(&self, dwconnection: u32) -> Result<()> {
        let holder = self.state.borrow().data_advise.clone();
        // SAFETY: COM call.
        unsafe {
            holder
                .ok_or_else(|| windows::core::Error::from(OLE_E_ADVISENOTSUPPORTED))?
                .Unadvise(dwconnection)
        }
    }

    fn EnumDAdvise(&self) -> Result<IEnumSTATDATA> {
        let holder = self.state.borrow().data_advise.clone();
        // SAFETY: COM call.
        unsafe {
            holder
                .ok_or_else(|| windows::core::Error::from(OLE_E_ADVISENOTSUPPORTED))?
                .EnumAdvise()
        }
    }
}

/// A `CF_METAFILEPICT` block (a Windows metafile with its HIMETRIC size) for containers that ask
/// for the older picture format.
fn metafile_picture(handle: HENHMETAFILE, extent: SIZE) -> Result<HGLOBAL> {
    // SAFETY: GDI conversions on a valid enhanced metafile; the HGLOBAL is handed to the caller.
    unsafe {
        let screen = GetDC(None);
        let length = GetWinMetaFileBits(handle, None, MM_ANISOTROPIC, screen);
        let mut bits = vec![0u8; length as usize];
        let written = if length > 0 {
            GetWinMetaFileBits(handle, Some(&mut bits), MM_ANISOTROPIC, screen)
        } else {
            0
        };
        ReleaseDC(None, screen);
        if written == 0 {
            return Err(E_FAIL.into());
        }
        let metafile = SetMetaFileBitsEx(&bits[..written as usize]);
        if metafile.is_invalid() {
            return Err(E_FAIL.into());
        }
        let global = GlobalAlloc(GMEM_MOVEABLE, std::mem::size_of::<METAFILEPICT>())?;
        let pointer = GlobalLock(global) as *mut METAFILEPICT;
        if pointer.is_null() {
            return Err(E_FAIL.into());
        }
        *pointer = METAFILEPICT {
            mm: MM_ANISOTROPIC,
            xExt: extent.cx,
            yExt: extent.cy,
            hMF: metafile,
        };
        let _ = GlobalUnlock(global);
        Ok(global)
    }
}

impl IPersist_Impl for Drawing_Impl {
    fn GetClassID(&self) -> Result<GUID> {
        Ok(server()?.clsid)
    }
}

impl IPersistStorage_Impl for Drawing_Impl {
    fn IsDirty(&self) -> HRESULT {
        if self.state.borrow().dirty {
            S_OK
        } else {
            S_FALSE
        }
    }

    fn InitNew(&self, _pstg: Ref<'_, IStorage>) -> Result<()> {
        Ok(())
    }

    fn Load(&self, pstg: Ref<'_, IStorage>) -> Result<()> {
        log("Load");
        let storage = pstg.ok()?;
        // SAFETY: COM reads of the container's storage for this object.
        let (document, picture) = unsafe {
            if ReadClassStg(storage)? != server()?.clsid {
                return Err(E_FAIL.into());
            }
            (
                read_stream(storage, DOCUMENT_STREAM)?,
                read_stream(storage, PICTURE_STREAM).unwrap_or_default(),
            )
        };
        let mut state = self.state.borrow_mut();
        state.document = String::from_utf8_lossy(&document).into_owned();
        if let Some((cx, cy)) = ole_registration::emf_frame_himetric(&picture) {
            state.extent = SIZE { cx, cy };
        }
        state.picture = picture;
        state.dirty = false;
        Ok(())
    }

    fn Save(&self, pstgsave: Ref<'_, IStorage>, _fsameasload: BOOL) -> Result<()> {
        log("Save");
        let storage = pstgsave.ok()?;
        let server = server()?;
        let (document, picture) = {
            let state = self.state.borrow();
            (state.document.clone(), state.picture.clone())
        };
        // SAFETY: COM writes into the storage the container hands over for this call.
        unsafe {
            write_storage(
                storage,
                &server.clsid,
                &server.class,
                document.as_bytes(),
                &picture,
            )?
        };
        self.state.borrow_mut().dirty = false;
        Ok(())
    }

    fn SaveCompleted(&self, _pstgnew: Ref<'_, IStorage>) -> Result<()> {
        Ok(())
    }

    fn HandsOffStorage(&self) -> Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::System::Com::TYMED_HGLOBAL;

    #[test]
    fn temporary_file_names_are_safe_and_named_after_the_container() {
        assert_eq!(
            temporary_file_name("Document1"),
            "Drawing in Document1.chemdraft"
        );
        assert_eq!(
            temporary_file_name("Report: draft/2"),
            "Drawing in Report_ draft_2.chemdraft"
        );
        assert_eq!(temporary_file_name(""), "Drawing from Office.chemdraft");
        assert_eq!(temporary_file_name("..."), "Drawing from Office.chemdraft");
    }

    #[test]
    fn both_class_ids_become_guids() {
        for identifier in ["org.chemdraft.desktop", ole_registration::DEV_IDENTIFIER] {
            let class = ole_registration::ole_class_for_identifier(identifier);
            let guid = guid_from_class(&class).unwrap();
            assert_eq!(
                format!("{{{guid:?}}}").to_uppercase(),
                class.class_id.to_uppercase()
            );
        }
    }

    #[test]
    fn the_drawing_offers_its_picture_formats_only_for_content() {
        let mut format = FORMATETC {
            cfFormat: CF_ENHMETAFILE,
            ptd: std::ptr::null_mut(),
            dwAspect: DVASPECT_CONTENT.0,
            lindex: -1,
            tymed: TYMED_ENHMF.0 as u32,
        };
        assert_eq!(format_supported(&format), Some(CF_ENHMETAFILE));
        format.tymed = TYMED_HGLOBAL.0 as u32;
        assert_eq!(format_supported(&format), None);
        format.cfFormat = CF_METAFILEPICT;
        format.tymed = TYMED_MFPICT.0 as u32;
        assert_eq!(format_supported(&format), Some(CF_METAFILEPICT));
        format.dwAspect = 4; // DVASPECT_ICON
        assert_eq!(format_supported(&format), None);
    }
}
