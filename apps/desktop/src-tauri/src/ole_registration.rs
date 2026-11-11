//! Per-user registration of ChemDraft as an Office-embeddable object ("ChemDraft Drawing"), so a
//! drawing copied with Ctrl+C pastes into Word, PowerPoint or Excel as an object that a double-click
//! opens back in ChemDraft. Everything goes under `HKEY_CURRENT_USER\Software\Classes`: no
//! administrator rights, and it is rewritten at every start so it follows the app if it moves.
//!
//! The stable app and the dev build ("ChemDraft (dev)") are separate applications (AGENTS.md
//! §15.2), so each has its own class id and ProgID and never opens the other's objects.
//!
//! The entry list is plain data, built and tested on every platform; only Windows writes it.
#![cfg_attr(not(windows), allow(dead_code))]

/// The class id of objects the stable app embeds.
pub(crate) const STABLE_CLASS_ID: &str = "{E6787EAD-4295-42DB-8CAC-8740B25CBE26}";
/// The class id of objects the dev build embeds.
pub(crate) const DEV_CLASS_ID: &str = "{08A17A3B-CB80-48E9-9DFA-DE1FE26FFF99}";
/// The dev build's bundle identifier.
pub(crate) const DEV_IDENTIFIER: &str = "org.chemdraft.desktop.dev";

/// Which embeddable class this application serves.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OleClass {
    pub class_id: &'static str,
    pub prog_id: &'static str,
    pub user_type: &'static str,
    pub short_name: &'static str,
}

pub(crate) fn ole_class_for_identifier(identifier: &str) -> OleClass {
    if identifier == DEV_IDENTIFIER {
        OleClass {
            class_id: DEV_CLASS_ID,
            prog_id: "ChemDraftDev.Drawing.1",
            user_type: "ChemDraft (dev) Drawing",
            short_name: "ChemDraft (dev)",
        }
    } else {
        OleClass {
            class_id: STABLE_CLASS_ID,
            prog_id: "ChemDraft.Drawing.1",
            user_type: "ChemDraft Drawing",
            short_name: "ChemDraft",
        }
    }
}

/// One registry value: `subkey` under `HKCU\Software\Classes`, `name` (empty for the default
/// value), and string `data`. A value of `None` only creates the key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RegistryEntry {
    pub subkey: String,
    pub name: &'static str,
    pub data: Option<String>,
}

/// Clipboard format 14 (`CF_ENHMETAFILE`) and 3 (`CF_METAFILEPICT`): the pictures the object hands
/// Office, read with `OleRegEnumFormatEtc`. Each is "format,aspect,medium,direction":
/// DVASPECT_CONTENT = 1, TYMED_ENHMF = 64, TYMED_MFPICT = 32, DATADIR_GET = 1.
const DATA_FORMATS: [&str; 2] = ["14,1,64,1", "3,1,32,1"];

pub(crate) fn registry_entries(class: &OleClass, exe_path: &str) -> Vec<RegistryEntry> {
    let clsid = format!("CLSID\\{}", class.class_id);
    let entry = |subkey: String, name: &'static str, data: Option<String>| RegistryEntry {
        subkey,
        name,
        data,
    };
    let mut entries = vec![
        entry(clsid.clone(), "", Some(class.user_type.to_string())),
        entry(
            format!("{clsid}\\LocalServer32"),
            "",
            Some(format!("\"{exe_path}\"")),
        ),
        entry(
            format!("{clsid}\\InprocHandler32"),
            "",
            Some("ole32.dll".to_string()),
        ),
        entry(
            format!("{clsid}\\ProgID"),
            "",
            Some(class.prog_id.to_string()),
        ),
        entry(
            format!("{clsid}\\DefaultIcon"),
            "",
            Some(format!("\"{exe_path}\",0")),
        ),
        entry(format!("{clsid}\\MiscStatus"), "", Some("0".to_string())),
        entry(
            format!("{clsid}\\AuxUserType\\2"),
            "",
            Some(class.short_name.to_string()),
        ),
        entry(
            format!("{clsid}\\AuxUserType\\3"),
            "",
            Some(class.short_name.to_string()),
        ),
        // Verb 0 is the primary verb (double-click): open the drawing in ChemDraft.
        entry(
            format!("{clsid}\\Verb\\0"),
            "",
            Some("&Edit,0,2".to_string()),
        ),
        entry(
            format!("{clsid}\\Verb\\1"),
            "",
            Some("&Open,0,2".to_string()),
        ),
        entry(
            class.prog_id.to_string(),
            "",
            Some(class.user_type.to_string()),
        ),
        entry(
            format!("{}\\CLSID", class.prog_id),
            "",
            Some(class.class_id.to_string()),
        ),
        // Offered under Insert > Object: a new object opens as an empty page in ChemDraft.
        entry(format!("{clsid}\\Insertable"), "", None),
        entry(format!("{}\\Insertable", class.prog_id), "", None),
    ];
    for (index, format) in DATA_FORMATS.iter().enumerate() {
        entries.push(entry(
            format!("{clsid}\\DataFormats\\GetSet\\{index}"),
            "",
            Some((*format).to_string()),
        ));
    }
    entries
}

/// An empty Enhanced Metafile `width` x `height` HIMETRIC (0.01 mm) in size, at the 96 dpi
/// reference the drawings use: the placeholder an object inserted from Office shows until its
/// first drawing is saved.
pub(crate) fn blank_emf(width: i32, height: i32) -> Vec<u8> {
    let pixels = |hmm: i32| ((f64::from(hmm) / 2540.0 * 96.0).round() as i32).max(1);
    let mut emf = Vec::with_capacity(128);
    let mut push = |value: i32| emf.extend_from_slice(&value.to_le_bytes());
    push(1); // EMR_HEADER
    push(108);
    for value in [0, 0, pixels(width) - 1, pixels(height) - 1] {
        push(value); // rclBounds, device pixels
    }
    for value in [0, 0, width - 1, height - 1] {
        push(value); // rclFrame, 0.01 mm
    }
    push(0x464d_4520); // " EMF"
    push(0x10000); // version
    push(128); // nBytes
    push(2); // nRecords
    push(1); // nHandles (u16) and reserved (u16)
    for value in [0, 0, 0] {
        push(value); // description (count, offset), palette entries
    }
    for value in [1920, 1080, 508, 286, 0, 0, 0, 508_000, 285_750] {
        push(value); // reference device, pixel format, OpenGL, micrometres
    }
    for value in [14, 20, 0, 16, 20] {
        push(value); // EMR_EOF: no palette, offset, size
    }
    emf
}

/// The `OBJECTDESCRIPTOR` block Office reads from the clipboard's "Object Descriptor" format: the
/// class, the content aspect, the picture size in HIMETRIC (0.01 mm), and two strings (the
/// object's full type name and where it was copied from).
pub(crate) fn object_descriptor_bytes(
    class_id: [u8; 16],
    size_himetric: (i32, i32),
    user_type: &str,
    source: &str,
) -> Vec<u8> {
    const HEADER: u32 = 52;
    let utf16 = |text: &str| {
        text.encode_utf16()
            .chain(std::iter::once(0))
            .flat_map(|unit| unit.to_le_bytes())
            .collect::<Vec<u8>>()
    };
    let type_name = utf16(user_type);
    let source_name = utf16(source);
    let total = HEADER as usize + type_name.len() + source_name.len();
    let mut bytes = Vec::with_capacity(total);
    bytes.extend_from_slice(&(total as u32).to_le_bytes()); // cbSize
    bytes.extend_from_slice(&class_id); // clsid
    bytes.extend_from_slice(&1u32.to_le_bytes()); // dwDrawAspect: DVASPECT_CONTENT
    bytes.extend_from_slice(&size_himetric.0.to_le_bytes()); // sizel.cx
    bytes.extend_from_slice(&size_himetric.1.to_le_bytes()); // sizel.cy
    bytes.extend_from_slice(&0i32.to_le_bytes()); // pointl.x
    bytes.extend_from_slice(&0i32.to_le_bytes()); // pointl.y
    bytes.extend_from_slice(&0u32.to_le_bytes()); // dwStatus (OLEMISC)
    bytes.extend_from_slice(&HEADER.to_le_bytes()); // dwFullUserTypeName
    bytes.extend_from_slice(&(HEADER + type_name.len() as u32).to_le_bytes()); // dwSrcOfCopy
    bytes.extend_from_slice(&type_name);
    bytes.extend_from_slice(&source_name);
    bytes
}

/// A class id string ("{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}") in the GUID's memory layout
/// (first three fields little-endian), or `None` if it is not one.
pub(crate) fn class_id_bytes(class_id: &str) -> Option<[u8; 16]> {
    let hex = class_id.trim_matches(|c| c == '{' || c == '}');
    let parts = hex.split('-').collect::<Vec<_>>();
    if parts.len() != 5 || parts.iter().map(|part| part.len()).ne([8, 4, 4, 4, 12]) {
        return None;
    }
    let data1 = u32::from_str_radix(parts[0], 16).ok()?;
    let data2 = u16::from_str_radix(parts[1], 16).ok()?;
    let data3 = u16::from_str_radix(parts[2], 16).ok()?;
    let tail = format!("{}{}", parts[3], parts[4]);
    let mut bytes = [0u8; 16];
    bytes[0..4].copy_from_slice(&data1.to_le_bytes());
    bytes[4..6].copy_from_slice(&data2.to_le_bytes());
    bytes[6..8].copy_from_slice(&data3.to_le_bytes());
    for index in 0..8 {
        bytes[8 + index] = u8::from_str_radix(tail.get(index * 2..index * 2 + 2)?, 16).ok()?;
    }
    Some(bytes)
}

/// The picture size an Enhanced Metafile declares in its header frame (`rclFrame`), in HIMETRIC.
pub(crate) fn emf_frame_himetric(emf: &[u8]) -> Option<(i32, i32)> {
    let read = |offset: usize| -> Option<i32> {
        Some(i32::from_le_bytes(
            emf.get(offset..offset + 4)?.try_into().ok()?,
        ))
    };
    if read(0)? != 1 || emf.get(40..44)? != b" EMF" {
        return None;
    }
    let (left, top, right, bottom) = (read(24)?, read(28)?, read(32)?, read(36)?);
    Some((right - left + 1, bottom - top + 1))
}

/// The same Enhanced Metafile described for the screen it is used on: `device_px` pixels over
/// `device_mm` millimetres (GDI's HORZRES/VERTRES and HORZSIZE/VERTSIZE). The drawing keeps its
/// 96 dpi pixel geometry (device bounds, viewport); the header names that screen as its reference
/// device and states the frame (the physical size) those pixels have on it.
///
/// Word measures pictures both ways: by the frame against the screen's physical resolution, and
/// by the device pixels at 96 dpi. On a screen whose physical resolution is not 96 dpi (here 1920
/// px over 345 mm, 141 dpi) a plain 96 dpi metafile disagrees with itself by 1.47: an embedded
/// object pasted 1.47x too big and grew by 1.47 at every update. Described this way the two
/// measures agree, and the picture keeps its 96 dpi size in Word whichever one Word uses.
/// Applying it twice gives the same bytes.
pub(crate) fn emf_for_screen(
    emf: &[u8],
    device_px: (i32, i32),
    device_mm: (i32, i32),
) -> Option<Vec<u8>> {
    let int = |offset: usize| -> Option<i32> {
        Some(i32::from_le_bytes(
            emf.get(offset..offset + 4)?.try_into().ok()?,
        ))
    };
    emf_frame_himetric(emf)?;
    if device_px.0 <= 0 || device_px.1 <= 0 || device_mm.0 <= 0 || device_mm.1 <= 0 {
        return None;
    }
    let bounds_width = int(16)? - int(8)? + 1;
    let bounds_height = int(20)? - int(12)? + 1;
    if bounds_width <= 0 || bounds_height <= 0 {
        return None;
    }
    let himetric = |px: i32, device: i32, mm: i32| {
        ((f64::from(px) * f64::from(mm) * 100.0 / f64::from(device)).round() as i32).max(1)
    };
    let frame_width = himetric(bounds_width, device_px.0, device_mm.0);
    let frame_height = himetric(bounds_height, device_px.1, device_mm.1);
    let mut out = emf.to_vec();
    let mut put =
        |offset: usize, value: i32| out[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    put(24, 0); // rclFrame, 0.01 mm
    put(28, 0);
    put(32, frame_width - 1);
    put(36, frame_height - 1);
    put(72, device_px.0); // szlDevice
    put(76, device_px.1);
    put(80, device_mm.0); // szlMillimeters
    put(84, device_mm.1);
    put(100, device_mm.0 * 1000); // szlMicrometers
    put(104, device_mm.1 * 1000);
    Some(out)
}
#[cfg(windows)]
pub(crate) mod native {
    use super::RegistryEntry;
    use windows_sys::Win32::System::Registry::{RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ};

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Write every entry under `HKCU\Software\Classes`. Returns the entries that failed.
    pub(crate) fn write_registry_entries(entries: &[RegistryEntry]) -> Vec<String> {
        entries
            .iter()
            .filter_map(|entry| {
                let subkey = wide(&format!("Software\\Classes\\{}", entry.subkey));
                let name = wide(entry.name);
                let data = wide(entry.data.as_deref().unwrap_or(""));
                // SAFETY: every pointer is a NUL-terminated UTF-16 buffer that outlives the call;
                // the data length is the buffer's length in bytes, terminator included.
                let status = unsafe {
                    RegSetKeyValueW(
                        HKEY_CURRENT_USER,
                        subkey.as_ptr(),
                        if entry.name.is_empty() {
                            std::ptr::null()
                        } else {
                            name.as_ptr()
                        },
                        REG_SZ,
                        data.as_ptr().cast(),
                        (data.len() * 2) as u32,
                    )
                };
                (status != 0).then(|| format!("{} ({status})", entry.subkey))
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_and_stable_builds_register_different_classes() {
        let dev = ole_class_for_identifier(DEV_IDENTIFIER);
        let stable = ole_class_for_identifier("org.chemdraft.desktop");
        assert_ne!(dev.class_id, stable.class_id);
        assert_ne!(dev.prog_id, stable.prog_id);
    }

    #[test]
    fn registry_entries_point_the_class_at_the_running_exe() {
        let class = ole_class_for_identifier("org.chemdraft.desktop");
        let entries = registry_entries(&class, "C:\\Apps\\ChemDraft\\chemdraft.exe");
        let value = |subkey: &str| {
            entries
                .iter()
                .find(|entry| entry.subkey == subkey)
                .and_then(|entry| entry.data.clone())
        };
        let clsid = format!("CLSID\\{STABLE_CLASS_ID}");
        assert_eq!(
            value(&format!("{clsid}\\LocalServer32")).as_deref(),
            Some("\"C:\\Apps\\ChemDraft\\chemdraft.exe\"")
        );
        assert_eq!(
            value("ChemDraft.Drawing.1\\CLSID").as_deref(),
            Some(STABLE_CLASS_ID)
        );
        assert_eq!(
            value(&format!("{clsid}\\Verb\\0")).as_deref(),
            Some("&Edit,0,2")
        );
        // Offered under Insert > Object, on both the class and its ProgID (keys without a value).
        for subkey in [
            format!("{clsid}\\Insertable"),
            "ChemDraft.Drawing.1\\Insertable".to_string(),
        ] {
            assert!(entries
                .iter()
                .any(|entry| entry.subkey == subkey && entry.data.is_none()));
        }
    }

    #[test]
    fn blank_emf_is_a_well_formed_empty_picture_of_the_given_size() {
        let emf = blank_emf(4000, 2000);
        let int = |offset: usize| i32::from_le_bytes(emf[offset..offset + 4].try_into().unwrap());
        assert_eq!(emf_frame_himetric(&emf), Some((4000, 2000)));
        assert_eq!(int(48) as usize, emf.len()); // nBytes
        assert_eq!(int(52), 2); // header + EOF
                                // 40 mm at 96 dpi is 151 px.
        assert_eq!(int(16), 150);
        assert_eq!(&emf[emf.len() - 20..emf.len() - 16], &14u32.to_le_bytes());
    }

    #[test]
    fn class_ids_parse_into_guid_memory_layout() {
        let bytes = class_id_bytes("{00020906-0000-0000-C000-000000000046}").unwrap();
        assert_eq!(
            bytes,
            [0x06, 0x09, 0x02, 0x00, 0, 0, 0, 0, 0xC0, 0, 0, 0, 0, 0, 0, 0x46]
        );
        assert!(class_id_bytes("not a guid").is_none());
        assert!(class_id_bytes(STABLE_CLASS_ID).is_some());
        assert!(class_id_bytes(DEV_CLASS_ID).is_some());
    }

    #[test]
    fn object_descriptor_carries_class_size_and_names() {
        let class = class_id_bytes(STABLE_CLASS_ID).unwrap();
        let bytes = object_descriptor_bytes(class, (2540, 1270), "ChemDraft Drawing", "ChemDraft");
        let u32_at =
            |offset: usize| u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap());
        assert_eq!(u32_at(0) as usize, bytes.len());
        assert_eq!(&bytes[4..20], &class);
        assert_eq!(u32_at(20), 1);
        assert_eq!(u32_at(24), 2540);
        assert_eq!(u32_at(28), 1270);
        assert_eq!(u32_at(44), 52);
        let type_name_end = 52 + ("ChemDraft Drawing".len() + 1) * 2;
        assert_eq!(u32_at(48) as usize, type_name_end);
    }

    #[test]
    fn emf_for_screen_states_the_physical_size_of_its_96_dpi_pixels() {
        // A header (108 bytes) with 96 x 48 px bounds and a 2540 x 1270 (0.01 mm) frame at 96 dpi.
        let mut emf = vec![0u8; 108];
        emf[0..4].copy_from_slice(&1u32.to_le_bytes());
        emf[4..8].copy_from_slice(&108u32.to_le_bytes());
        emf[16..20].copy_from_slice(&95i32.to_le_bytes());
        emf[20..24].copy_from_slice(&47i32.to_le_bytes());
        emf[32..36].copy_from_slice(&2539i32.to_le_bytes());
        emf[36..40].copy_from_slice(&1269i32.to_le_bytes());
        emf[40..44].copy_from_slice(b" EMF");
        let moved = emf_for_screen(&emf, (1920, 1200), (345, 215)).unwrap();
        let int = |offset: usize| i32::from_le_bytes(moved[offset..offset + 4].try_into().unwrap());
        // 96 px on a 1920 px / 345 mm screen is 17.25 mm; 48 px on 1200 px / 215 mm is 8.6 mm.
        assert_eq!(emf_frame_himetric(&moved), Some((1725, 860)));
        assert_eq!((int(16), int(20)), (95, 47));
        assert_eq!((int(72), int(76), int(80), int(84)), (1920, 1200, 345, 215));
        // Idempotent, and refused without a screen.
        assert_eq!(
            emf_for_screen(&moved, (1920, 1200), (345, 215)).unwrap(),
            moved
        );
        assert!(emf_for_screen(&emf, (0, 0), (345, 215)).is_none());
    }
    #[test]
    fn emf_frame_reads_the_header_size() {
        let mut emf = vec![0u8; 108];
        emf[0..4].copy_from_slice(&1u32.to_le_bytes());
        emf[32..36].copy_from_slice(&2539i32.to_le_bytes());
        emf[36..40].copy_from_slice(&1269i32.to_le_bytes());
        emf[40..44].copy_from_slice(b" EMF");
        assert_eq!(emf_frame_himetric(&emf), Some((2540, 1270)));
        assert_eq!(emf_frame_himetric(&[0u8; 10]), None);
    }
}
