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
//! stores it through `IPersistStorage::Save`, and the data-change notice gives Word the new
//! picture. Closing the drawing's tab (`embedding_closed`) tells Word the editing ended.
//!
//! Threads: COM interfaces Word hands us (the client site, the advise sinks) may only be called
//! from the apartment that received them, and our objects (agile, as `#[implement]` makes them)
//! may be called on any thread. So every interface from Word is parked in the global interface
//! table as it arrives, and every call to Word takes a fresh copy from the table, which COM makes
//! valid for the calling thread. Calls to Word are made from a worker thread in the multithreaded
//! apartment, never from inside the webview's message callback a save or a tab close arrives in.

use std::collections::HashSet;
use std::mem::ManuallyDrop;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

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
    CoCreateInstance, CoInitializeEx, CoRegisterClassObject, IAdviseSink, IClassFactory,
    IClassFactory_Impl, IDataObject, IDataObject_Impl, IEnumFORMATETC, IEnumSTATDATA,
    IGlobalInterfaceTable, IMoniker, IPersist_Impl, IStream, ADVF_NODATA, CLSCTX_INPROC_SERVER,
    CLSCTX_LOCAL_SERVER, COINIT_APARTMENTTHREADED, COINIT_MULTITHREADED, DVASPECT,
    DVASPECT_CONTENT, FORMATETC, REGCLS_MULTIPLEUSE, STATFLAG_NONAME, STATSTG, STGMEDIUM,
    STGMEDIUM_0, STGM_CREATE, STGM_READ, STGM_READWRITE, STGM_SHARE_EXCLUSIVE, TYMED_ENHMF,
    TYMED_MFPICT,
};
use windows::Win32::System::DataExchange::{RegisterClipboardFormatW, METAFILEPICT};
use windows::Win32::System::Memory::{
    GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE,
};
use windows::Win32::System::Ole::{
    IEnumOLEVERB, IOleClientSite, IOleObject, IOleObject_Impl, OleRegEnumFormatEtc,
    OleRegEnumVerbs, OleRegGetUserType, ReleaseStgMedium, OLECLOSE, OLEGETMONIKER, OLEIVERB_HIDE,
    OLEMISC, OLEWHICHMK, USERCLASSTYPE,
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
/// The standard Global Interface Table (CLSID_StdGlobalInterfaceTable).
const STD_GLOBAL_INTERFACE_TABLE: GUID = GUID::from_u128(0x00000323_0000_0000_c000_000000000046);

struct Server {
    app: tauri::AppHandle,
    class: OleClass,
    clsid: GUID,
}

static SERVER: OnceLock<Server> = OnceLock::new();
/// Temporary files of drawings open for editing (lower-cased paths).
static EDITING_PATHS: Mutex<Option<HashSet<String>>> = Mutex::new(None);
static NEXT_EDIT: AtomicU64 = AtomicU64::new(1);
/// Connection numbers handed out by Advise and DAdvise.
static NEXT_CONNECTION: AtomicU32 = AtomicU32::new(1);

/// Drawings open for editing, by temporary file, shared by every thread.
static OPEN_DRAWINGS: Mutex<Vec<OpenDrawing>> = Mutex::new(Vec::new());

struct OpenDrawing {
    path_key: String,
    state: Arc<Mutex<DrawingState>>,
    /// The object's IDataObject in the global interface table (data-change notices carry it).
    data_cookie: u32,
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

fn lock(state: &Mutex<DrawingState>) -> MutexGuard<'_, DrawingState> {
    state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn open_drawings() -> MutexGuard<'static, Vec<OpenDrawing>> {
    OPEN_DRAWINGS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

// ---------------------------------------------------------------------------------------------
// The global interface table

fn global_interface_table() -> Result<IGlobalInterfaceTable> {
    // SAFETY: creates (or returns) the process's free-threaded interface table.
    unsafe { CoCreateInstance(&STD_GLOBAL_INTERFACE_TABLE, None, CLSCTX_INPROC_SERVER) }
}

/// Park `interface` in the global table; the cookie gets it back on any thread.
fn park<T: Interface>(interface: &T) -> Result<u32> {
    let unknown: IUnknown = interface.cast()?;
    // SAFETY: registers a live interface pointer in the process's table, under its own IID.
    global_interface_table()
        .and_then(|table| unsafe { table.RegisterInterfaceInGlobal(&unknown, &T::IID) })
}

/// The parked interface, marshalled for the calling thread.
fn fetch<T: Interface>(cookie: u32) -> Result<T> {
    // SAFETY: the table AddRefs the interface it returns; `from_raw` takes over that reference.
    unsafe {
        let table = global_interface_table()?;
        let mut raw = std::ptr::null_mut();
        table.GetInterfaceFromGlobal(cookie, &T::IID, &mut raw)?;
        Ok(T::from_raw(raw))
    }
}

fn unpark(cookie: u32) {
    // SAFETY: removes this cookie's entry from the process's table.
    let _ = global_interface_table()
        .and_then(|table| unsafe { table.RevokeInterfaceFromGlobal(cookie) });
}

/// Run `work` on a fresh thread of the multithreaded apartment (where interfaces fetched from the
/// table are valid, and which is never inside a webview callback).
fn on_worker_thread(work: impl FnOnce() + Send + 'static) {
    std::thread::spawn(move || {
        // SAFETY: joins this new thread to the multithreaded apartment.
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        work();
    });
}

// ---------------------------------------------------------------------------------------------
// Start-up and the clipboard

/// Register the class for this user and offer its factory to COM. Call once, on the main thread,
/// during setup. Failures are logged: copying and pasting pictures still works without them.
pub(crate) fn start(app: &tauri::AppHandle) {
    let class = ole_registration::ole_class_for_identifier(&app.config().identifier);
    let Some(clsid) = guid_from_class(&class) else {
        log(&format!("invalid embedding class id {}", class.class_id));
        return;
    };
    match std::env::current_exe() {
        Ok(exe) => {
            let entries = ole_registration::registry_entries(&class, &exe.to_string_lossy());
            let failed = ole_registration::native::write_registry_entries(&entries);
            if !failed.is_empty() {
                log(&format!(
                    "could not register the embedding class: {}",
                    failed.join(", ")
                ));
            }
        }
        Err(error) => log(&format!(
            "no executable path for the embedding class: {error}"
        )),
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
    // SAFETY: COM initialisation on the main thread (already done by the windowing layer, so this
    // only adds a reference), and registering a factory object that COM keeps alive.
    unsafe {
        let joined = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        log(&format!("main thread COM: {joined:?}"));
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
            log(&format!("could not build the embedded drawing: {error}"));
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

// ---------------------------------------------------------------------------------------------
// Saves and closes from ChemDraft

fn open_drawing(path: &str) -> Option<(Arc<Mutex<DrawingState>>, u32)> {
    let key = path_key(Path::new(path));
    let editing = EDITING_PATHS
        .lock()
        .map(|paths| paths.as_ref().is_some_and(|paths| paths.contains(&key)))
        .unwrap_or(false);
    if !editing {
        return None;
    }
    open_drawings()
        .iter()
        .find(|drawing| drawing.path_key == key)
        .map(|drawing| (drawing.state.clone(), drawing.data_cookie))
}

/// A saved file: if it is the temporary copy of a drawing open for editing, hand the drawing and
/// its picture back to the Office document. Returns whether it was one.
pub(crate) fn embedding_saved(path: &str, emf: Option<Vec<u8>>) -> bool {
    let Some((state, data_cookie)) = open_drawing(path) else {
        if path.contains("ChemDraft Office drawings") {
            log(&format!("saved {path}: not a drawing open for editing"));
        }
        return false;
    };
    let contents = match std::fs::read(path) {
        Ok(bytes) => crate::decode_document_text(&bytes),
        Err(error) => {
            log(&format!("could not read the saved drawing {path}: {error}"));
            return false;
        }
    };
    log(&format!(
        "saved {path}: handing it back to the Office document"
    ));
    {
        let mut state = lock(&state);
        state.document = contents;
        if let Some(emf) = emf.filter(|bytes| !bytes.is_empty()) {
            if let Some((cx, cy)) = ole_registration::emf_frame_himetric(&emf) {
                state.extent = SIZE { cx, cy };
            }
            state.picture = emf;
        }
        state.dirty = true;
    }
    on_worker_thread(move || notify_saved(&state, data_cookie));
    true
}

/// A drawing's ChemDraft tab was closed: tell the container the editing ended, so it stops
/// showing the object as open (hatched) and keeps what was last saved.
pub(crate) fn embedding_closed(path: &str) -> bool {
    let Some((state, _)) = open_drawing(path) else {
        return false;
    };
    log(&format!("closed {path}"));
    on_worker_thread(move || {
        notify_closed(&state);
        forget_editing(&state);
    });
    true
}

/// Tell the container the drawing changed: save it, then hand every data sink the new picture
/// and every object sink the save notice.
fn notify_saved(state: &Arc<Mutex<DrawingState>>, data_cookie: u32) {
    let (site, data_sinks, object_sinks) = {
        let state = lock(state);
        (
            state.client_site,
            state.data_sinks.clone(),
            state.object_sinks.clone(),
        )
    };
    match site.map(fetch::<IOleClientSite>) {
        // SAFETY: a COM call through an interface marshalled for this thread.
        Some(Ok(site)) => log(&format!("SaveObject: {:?}", unsafe { site.SaveObject() })),
        Some(Err(error)) => log(&format!("SaveObject: no client site ({error})")),
        None => log("SaveObject: no client site"),
    }
    let data_object = fetch::<IDataObject>(data_cookie).ok();
    for sink in data_sinks {
        let result = fetch::<IAdviseSink>(sink.cookie).map(|advise| {
            let mut medium = if sink.advf & ADVF_NODATA.0 as u32 != 0 {
                None
            } else {
                data_object.as_ref().and_then(|data| {
                    // SAFETY: asks this object for its picture through COM.
                    unsafe { data.GetData(&sink.format) }.ok()
                })
            };
            let empty = STGMEDIUM {
                tymed: 0,
                u: STGMEDIUM_0 {
                    hGlobal: HGLOBAL::default(),
                },
                pUnkForRelease: ManuallyDrop::new(None),
            };
            // SAFETY: the sink copies what it keeps; the medium is released right after.
            unsafe {
                advise.OnDataChange(&sink.format, medium.as_ref().unwrap_or(&empty));
                if let Some(medium) = medium.as_mut() {
                    ReleaseStgMedium(medium);
                }
            }
        });
        log(&format!(
            "OnDataChange (format {}): {result:?}",
            sink.format.cfFormat
        ));
    }
    for cookie in object_sinks.iter().map(|sink| sink.1) {
        let result = fetch::<IAdviseSink>(cookie).map(|advise| {
            // SAFETY: COM calls through an interface marshalled for this thread.
            unsafe {
                advise.OnViewChange(DVASPECT_CONTENT.0, -1);
                advise.OnSave();
            }
        });
        log(&format!("OnSave: {result:?}"));
    }
}

/// Tell the container the editing ended.
fn notify_closed(state: &Arc<Mutex<DrawingState>>) {
    let (site, object_sinks) = {
        let state = lock(state);
        (state.client_site, state.object_sinks.clone())
    };
    if let Some(site) = site.and_then(|cookie| fetch::<IOleClientSite>(cookie).ok()) {
        // SAFETY: a COM call through an interface marshalled for this thread.
        log(&format!("OnShowWindow(false): {:?}", unsafe {
            site.OnShowWindow(false)
        }));
    }
    for cookie in object_sinks.iter().map(|sink| sink.1) {
        let result = fetch::<IAdviseSink>(cookie).map(|advise| {
            // SAFETY: a COM call through an interface marshalled for this thread.
            unsafe { advise.OnClose() }
        });
        log(&format!("OnClose: {result:?}"));
    }
}

/// Stop treating the drawing as open for editing.
fn forget_editing(state: &Arc<Mutex<DrawingState>>) {
    let path = lock(state).temp_path.clone();
    let Some(path) = path else {
        return;
    };
    let key = path_key(&path);
    if let Ok(mut paths) = EDITING_PATHS.lock() {
        if let Some(paths) = paths.as_mut() {
            paths.remove(&key);
        }
    }
    open_drawings().retain(|drawing| {
        let keep = drawing.path_key != key;
        if !keep {
            unpark(drawing.data_cookie);
        }
        keep
    });
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
        let _ = writeln!(
            file,
            "{seconds:.3} [{} {:?}] {message}",
            std::process::id(),
            std::thread::current().id()
        );
    }
}

// ---------------------------------------------------------------------------------------------
// Structured storage

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

/// A data sink from DAdvise: the format it wants and its advise flags.
#[derive(Clone)]
struct DataSink {
    connection: u32,
    cookie: u32,
    format: FORMATETC,
    advf: u32,
}

struct DrawingState {
    /// The container's client site, parked in the global interface table.
    client_site: Option<u32>,
    /// Object sinks from Advise: (connection, table cookie).
    object_sinks: Vec<(u32, u32)>,
    data_sinks: Vec<DataSink>,
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

// SAFETY: the only raw pointer inside is a data sink's FORMATETC target device, always null here;
// interfaces are kept as global-table cookies, not pointers.
unsafe impl Send for DrawingState {}

#[implement(IOleObject, IDataObject, IPersistStorage)]
struct Drawing {
    state: Arc<Mutex<DrawingState>>,
}

impl Drawing {
    fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(DrawingState {
                client_site: None,
                object_sinks: Vec::new(),
                data_sinks: Vec::new(),
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
            let mut state = lock(&self.state);
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
        let data_cookie = park(&data_object)?;
        log(&format!("editing {}", path.display()));
        {
            let mut drawings = open_drawings();
            for old in drawings.iter().filter(|drawing| drawing.path_key == key) {
                unpark(old.data_cookie);
            }
            drawings.retain(|drawing| drawing.path_key != key);
            drawings.push(OpenDrawing {
                path_key: key,
                state: self.state.clone(),
                data_cookie,
            });
        }

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
            log(&format!("could not open the embedded drawing: {error}"));
            return Err(E_FAIL.into());
        }
        let site = lock(&self.state).client_site;
        if let Some(site) = site.and_then(|cookie| fetch::<IOleClientSite>(cookie).ok()) {
            // SAFETY: COM calls through an interface marshalled for this thread; failures only
            // affect the container's display.
            unsafe {
                let _ = site.ShowObject();
                let _ = site.OnShowWindow(true);
            }
        }
        Ok(())
    }

    fn picture_handle(&self) -> Option<HENHMETAFILE> {
        let state = lock(&self.state);
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
        let cookie = match pclientsite.as_ref() {
            Some(site) => Some(park(site)?),
            None => None,
        };
        let old = std::mem::replace(&mut lock(&self.state).client_site, cookie);
        if let Some(old) = old {
            unpark(old);
        }
        Ok(())
    }

    fn GetClientSite(&self) -> Result<IOleClientSite> {
        let cookie = lock(&self.state).client_site;
        cookie
            .ok_or_else(|| windows::core::Error::from(E_FAIL))
            .and_then(fetch::<IOleClientSite>)
    }

    fn SetHostNames(&self, _szcontainerapp: &PCWSTR, szcontainerobj: &PCWSTR) -> Result<()> {
        if !szcontainerobj.is_null() {
            // SAFETY: COM passes a NUL-terminated string valid for this call.
            let name = unsafe { szcontainerobj.to_string() }.unwrap_or_default();
            lock(&self.state).container_object = name;
        }
        Ok(())
    }

    fn Close(&self, _dwsaveoption: &OLECLOSE) -> Result<()> {
        log("Close");
        notify_closed(&self.state);
        forget_editing(&self.state);
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
        if lock(&self.state).client_site.is_none() {
            if let Some(site) = pactivesite.as_ref() {
                let cookie = park(site)?;
                lock(&self.state).client_site = Some(cookie);
            }
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
        // The drawing's size is its picture's: a container's size is not kept. Word handed back a
        // size it had converted with the screen's physical resolution, and returning that on the
        // next GetExtent grew the object by that ratio (1.47x on a 141 dpi screen) at every update.
        // SAFETY: COM passes a valid SIZE pointer.
        let size = unsafe { *psizel };
        log(&format!("SetExtent {} x {} (not kept)", size.cx, size.cy));
        Ok(())
    }

    fn GetExtent(&self, dwdrawaspect: DVASPECT) -> Result<SIZE> {
        if dwdrawaspect != DVASPECT_CONTENT {
            return Err(E_FAIL.into());
        }
        let state = lock(&self.state);
        let size = ole_registration::emf_frame_himetric(&state.picture)
            .map(|(cx, cy)| SIZE { cx, cy })
            .or((state.extent.cx > 0 && state.extent.cy > 0).then_some(state.extent));
        log(&format!("GetExtent: {size:?}"));
        size.ok_or_else(|| E_FAIL.into())
    }

    fn Advise(&self, padvsink: Ref<'_, IAdviseSink>) -> Result<u32> {
        log("Advise");
        let cookie = park(padvsink.ok()?)?;
        let connection = NEXT_CONNECTION.fetch_add(1, Ordering::SeqCst);
        lock(&self.state).object_sinks.push((connection, cookie));
        Ok(connection)
    }

    fn Unadvise(&self, dwconnection: u32) -> Result<()> {
        let mut state = lock(&self.state);
        state.object_sinks.retain(|(connection, cookie)| {
            let keep = *connection != dwconnection;
            if !keep {
                unpark(*cookie);
            }
            keep
        });
        Ok(())
    }

    fn EnumAdvise(&self) -> Result<IEnumSTATDATA> {
        Err(E_NOTIMPL.into())
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
        if format_supported(format).is_some() && !lock(&self.state).picture.is_empty() {
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
        if pformatetc.is_null() {
            return Err(DV_E_FORMATETC.into());
        }
        // SAFETY: COM passes a valid FORMATETC; its target device is not kept.
        let mut format = unsafe { *pformatetc };
        format.ptd = std::ptr::null_mut();
        let cookie = park(padvsink.ok()?)?;
        let connection = NEXT_CONNECTION.fetch_add(1, Ordering::SeqCst);
        lock(&self.state).data_sinks.push(DataSink {
            connection,
            cookie,
            format,
            advf,
        });
        Ok(connection)
    }

    fn DUnadvise(&self, dwconnection: u32) -> Result<()> {
        let mut state = lock(&self.state);
        state.data_sinks.retain(|sink| {
            let keep = sink.connection != dwconnection;
            if !keep {
                unpark(sink.cookie);
            }
            keep
        });
        Ok(())
    }

    fn EnumDAdvise(&self) -> Result<IEnumSTATDATA> {
        Err(OLE_E_ADVISENOTSUPPORTED.into())
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
        if lock(&self.state).dirty {
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
        let mut state = lock(&self.state);
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
            let state = lock(&self.state);
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
        lock(&self.state).dirty = false;
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
