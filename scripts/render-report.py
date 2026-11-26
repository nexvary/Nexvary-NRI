"""Render a local NRI report from its JSON document model."""
import io
import json
import sys
from html import escape

from docx import Document
from docx.enum.table import WD_TABLE_DIRECTION
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from weasyprint import HTML


def pdf(report):
    def forbid_resource(_url, **_kwargs):
        raise ValueError("Report resources must be local to the document")

    sections = []
    for section in report["sections"]:
        text = "".join(f'<p dir="auto">{escape(value)}</p>' for value in section.get("text", []))
        table = ""
        if section.get("rows"):
            headers = "".join(f"<th>{escape(value)}</th>" for value in section["headers"])
            rows = "".join("<tr>" + "".join(f'<td dir="auto">{escape(value)}</td>' for value in row) + "</tr>"
                           for row in section["rows"])
            table = f"<table><thead><tr>{headers}</tr></thead><tbody>{rows}</tbody></table>"
        sections.append(f'<section><h2>{escape(section["title"])}</h2>{text}{table}</section>')
    lang = report["lang"]
    direction = "rtl" if lang == "ar" else "ltr"
    html = f"""<!doctype html><html lang="{lang}" dir="{direction}"><head><meta charset="utf-8">
      <title>{escape(report['title'])}</title><style>
      @page {{ size: A4; margin: 18mm; @bottom-center {{ content: counter(page); }} }}
      body {{ font: 10.5pt "Noto Naskh Arabic", "DejaVu Sans", sans-serif; color: #15243a; }}
      h1, h2 {{ color: #183f66; break-after: avoid; }}
      table {{ width: 100%; border-collapse: collapse; table-layout: fixed; }}
      th, td {{ border: 1px solid #9da9ba; padding: 3mm; vertical-align: top; overflow-wrap: anywhere; }}
      th {{ background: #e9f1fa; }} p {{ white-space: pre-wrap; overflow-wrap: anywhere; }}
      </style></head><body><h1>{escape(report['title'])}</h1>
      <p dir="auto">{escape(report['subtitle'])}</p>{''.join(sections)}</body></html>"""
    return HTML(string=html, url_fetcher=forbid_resource).write_pdf()


def docx(report):
    document = Document()
    document.core_properties.title = report["title"]
    document.core_properties.language = report["lang"]
    rtl = report["lang"] == "ar"

    def apply_direction(paragraph):
        if rtl:
            paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
            props = paragraph._p.get_or_add_pPr()
            bidi = OxmlElement("w:bidi")
            bidi.set(qn("w:val"), "1")
            props.append(bidi)

    def add_paragraph(text, level=None):
        paragraph = document.add_heading(text, level) if level is not None else document.add_paragraph(text)
        apply_direction(paragraph)

    add_paragraph(report["title"], 0)
    add_paragraph(report["subtitle"])
    for section in report["sections"]:
        add_paragraph(section["title"], 1)
        for text in section.get("text", []):
            add_paragraph(text)
        if section.get("rows"):
            table = document.add_table(rows=0, cols=len(section["headers"]))
            table.style = "Table Grid"
            if rtl:
                table.table_direction = WD_TABLE_DIRECTION.RTL
            for index, row in enumerate([section["headers"], *section["rows"]]):
                cells = table.add_row().cells
                for cell, text in zip(cells, row):
                    paragraph = cell.paragraphs[0]
                    apply_direction(paragraph)
                    paragraph.add_run(text).bold = index == 0
    output = io.BytesIO()
    document.save(output)
    return output.getvalue()


if __name__ == "__main__":
    payload = json.load(sys.stdin)
    # XML 1.0 rejects control characters in user-supplied text.
    def clean(item):
        if isinstance(item, str):
            return "".join(char for char in item if char in "\t\n\r"
                           or 0x20 <= ord(char) <= 0xD7FF
                           or 0xE000 <= ord(char) <= 0xFFFD
                           or 0x10000 <= ord(char) <= 0x10FFFF)
        if isinstance(item, list):
            return [clean(value) for value in item]
        if isinstance(item, dict):
            return {key: clean(value) for key, value in item.items()}
        return item

    report = clean(payload)
    render = {"pdf": pdf, "docx": docx}[sys.argv[1]]
    sys.stdout.buffer.write(render(report))
