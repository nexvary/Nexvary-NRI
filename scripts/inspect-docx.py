"""Validate a bounded DOCX package and emit its main story as plain text."""
import io
import re
import stat
import sys
import zipfile
import zlib
from pathlib import PurePosixPath
from xml.etree import ElementTree as ET

CT = "{http://schemas.openxmlformats.org/package/2006/content-types}"
REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"
WORD = (
    "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}",
    "{http://purl.oclc.org/ooxml/wordprocessingml/main}",
)
OFFICE = {
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
    "http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument",
}
MAIN = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
MAX_INPUT = 8 * 1024 * 1024
MAX_PART = 4 * 1024 * 1024
MAX_TOTAL = 24 * 1024 * 1024
MAX_PREVIEW = 128 * 1024
UNSAFE = {"altchunk", "object", "control", "oleobject", "instrtext", "fldsimple", "fldchar", "subdoc"}
IMAGE_TYPES = {".png", ".jpeg", ".jpg", ".gif", ".bmp", ".tif", ".tiff"}


def require(condition):
    if not condition:
        raise ValueError("Unsupported DOCX package")


def valid_path(name):
    return (
        bool(re.fullmatch(r"[A-Za-z0-9_./\[\]-]+", name))
        and all(piece not in {"", ".", ".."} for piece in name.split("/"))
    )


def xml_tree(data):
    source = data.decode("utf-8-sig")
    require(not re.search(r"<!DOCTYPE|<!ENTITY|<\?(?!xml\s)", source))
    root = ET.fromstring(source)
    for node in root.iter():
        require(node.tag.rsplit("}", 1)[-1].lower() not in UNSAFE)
    return root


def inspect(raw):
    require(raw.startswith(b"PK\x03\x04"))
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries = archive.infolist()
        require(3 <= len(entries) <= 256)
        paths = set()
        members = set()
        trees = {}
        total = 0
        for part in entries:
            name = part.orig_filename
            path = name[:-1] if part.is_dir() else name
            require(valid_path(path) and path.lower() not in paths)
            paths.add(path.lower())
            require(stat.S_IFMT(part.external_attr >> 16) in {0, stat.S_IFREG, stat.S_IFDIR})
            require(not (part.flag_bits & 1) and part.compress_type in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED})
            if part.is_dir():
                require(part.file_size == 0)
                continue
            members.add(path)
            extension = PurePosixPath(path).suffix.lower()
            is_xml = extension in {".xml", ".rels"} or path == "_rels/.rels"
            require(is_xml or extension in IMAGE_TYPES)
            require(0 < part.file_size <= MAX_PART and part.file_size <= 200 * max(part.compress_size, 1))
            total += part.file_size
            require(total <= MAX_TOTAL)
            # Each member stays in memory. No package name is used as a filesystem path.
            with archive.open(part) as stream:
                data = stream.read(part.file_size + 1)
                require(len(data) == part.file_size and not stream.read(1))
            if is_xml:
                trees[path] = xml_tree(data)

        manifest = trees["[Content_Types].xml"]
        require(manifest.tag == CT + "Types")
        main_parts = []
        for item in manifest:
            content = item.attrib["ContentType"].lower()
            require(not any(marker in content for marker in ("macro", "activex", "oleobject", "vba")))
            if item.tag == CT + "Override" and content == MAIN:
                main_parts.append(item.attrib["PartName"])

        root_targets = []
        for path, root in trees.items():
            if not path.endswith(".rels"):
                continue
            require(root.tag == REL + "Relationships")
            seen = set()
            for item in root:
                identifier = item.attrib["Id"]
                target = item.attrib["Target"]
                relationship = item.attrib["Type"]
                require(item.tag == REL + "Relationship" and identifier not in seen)
                seen.add(identifier)
                require(item.get("TargetMode", "Internal") == "Internal" and valid_path(target.lstrip("/")))
                relation_name = relationship.rsplit("/", 1)[-1].lower()
                require(relation_name not in {"oleobject", "package", "activex", "vbaproject", "attachedtemplate", "afchunk", "control"})
                folder = PurePosixPath(path).parent.parent
                resolved = target.lstrip("/") if target.startswith("/") else str(folder / target)
                require(resolved in members)
                if path == "_rels/.rels" and relationship in OFFICE:
                    root_targets.append("/" + target.lstrip("/"))

        require(len(main_parts) == 1 and root_targets == main_parts)
        document = trees[main_parts[0].removeprefix("/")]
        namespace = next((ns for ns in WORD if document.tag == ns + "document"), "")
        require(bool(namespace))
        body = document.find(namespace + "body")
        require(body is not None)
        result = bytearray()
        for paragraph in body.iter(namespace + "p"):
            text = "".join(node.text or "" for node in paragraph.iter(namespace + "t"))
            encoded = text.encode("utf-8")
            available = MAX_PREVIEW - len(result)
            if len(encoded) + 1 > available:
                result.extend(encoded[:max(0, available)].decode("utf-8", "ignore").encode("utf-8"))
                break
            result.extend(encoded + b"\n")
        return result


if __name__ == "__main__":
    try:
        raw = sys.stdin.buffer.read(MAX_INPUT + 1)
        require(len(raw) <= MAX_INPUT)
        sys.stdout.buffer.write(inspect(raw))
    except (ValueError, KeyError, ET.ParseError, zipfile.BadZipFile, OSError, RuntimeError, zlib.error):
        sys.exit(2)
