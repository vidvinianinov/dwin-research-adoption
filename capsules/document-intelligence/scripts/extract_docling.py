from __future__ import annotations

import argparse
import hashlib
import json
import socket
from pathlib import Path


def sha(data: bytes | str) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def provenance_of(item) -> list[dict]:
    result = []
    for prov in getattr(item, "prov", []) or []:
        raw = prov.model_dump(mode="json")
        bbox = raw.get("bbox", {})
        charspan = raw.get("charspan", [0, 0])
        if isinstance(charspan, dict):
            charspan = [charspan.get("start", 0), charspan.get("end", 0)]
        result.append({
            "page_no": int(raw.get("page_no", 0)),
            "bbox": {
                "l": float(bbox.get("l", 0)),
                "t": float(bbox.get("t", 0)),
                "r": float(bbox.get("r", 0)),
                "b": float(bbox.get("b", 0)),
                "coord_origin": str(bbox.get("coord_origin", "BOTTOMLEFT")),
            },
            "charspan": [max(0, int(charspan[0])), max(0, int(charspan[1]))],
        })
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--artifacts", required=True)
    parser.add_argument("--config-hash", required=True)
    parser.add_argument("--model-hash", required=True)
    parser.add_argument("--max-pages", type=int, required=True)
    parser.add_argument("--max-file-bytes", type=int, required=True)
    args = parser.parse_args()

    input_path = Path(args.input).resolve(strict=True)
    artifacts_path = Path(args.artifacts).resolve(strict=True)
    output_path = Path(args.output)
    source_bytes = input_path.read_bytes()
    if not 0 < len(source_bytes) <= args.max_file_bytes:
        raise ValueError("source size outside policy")

    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex

    def deny_ip_connect(sock, address):
        if sock.family in (socket.AF_INET, socket.AF_INET6):
            raise RuntimeError("network disabled by DWIN document policy")
        return original_connect(sock, address)

    def deny_ip_connect_ex(sock, address):
        if sock.family in (socket.AF_INET, socket.AF_INET6):
            raise RuntimeError("network disabled by DWIN document policy")
        return original_connect_ex(sock, address)

    socket.socket.connect = deny_ip_connect
    socket.socket.connect_ex = deny_ip_connect_ex

    import docling
    from docling.datamodel.base_models import ConversionStatus, InputFormat
    from docling.datamodel.pipeline_options import HeadingHierarchyOptions, OcrMacOptions, PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling_core.types.doc.items.table.table import TableItem

    options = PdfPipelineOptions(
        artifacts_path=artifacts_path,
        document_timeout=250.0,
        enable_remote_services=False,
        allow_external_plugins=False,
        do_ocr=True,
        ocr_options=OcrMacOptions(lang=["en-US", "ru-RU"]),
        do_table_structure=True,
        do_code_enrichment=False,
        # Formula enrichment is deliberately disabled in the default production
        # profile: a 10-page formula-heavy pilot paper exceeded the bounded
        # extraction window. Formula recovery remains a future benchmark arm.
        do_formula_enrichment=False,
        do_picture_classification=False,
        do_picture_description=False,
        generate_page_images=False,
        generate_picture_images=False,
        generate_parsed_pages=True,
        heading_hierarchy_options=HeadingHierarchyOptions(enabled=True),
    )
    converter = DocumentConverter(
        allowed_formats=[InputFormat.PDF],
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)},
    )
    converted = converter.convert(input_path, max_num_pages=args.max_pages, max_file_size=args.max_file_bytes)
    if converted.status != ConversionStatus.SUCCESS:
        raise RuntimeError(f"conversion status is {converted.status.value}")
    document = converted.document
    page_count = len(document.pages)
    if not 0 < page_count <= args.max_pages:
        raise ValueError("page count outside policy")

    blocks = []
    source_hash = sha(source_bytes)
    for item, depth in document.iterate_items(with_groups=False, traverse_pictures=False):
        if isinstance(item, TableItem):
            text = item.export_to_markdown(doc=document).strip()
        else:
            text = str(getattr(item, "text", "") or "").strip()
        if not text:
            continue
        if len(text) > 20000:
            raise ValueError("block text exceeds policy")
        label_value = getattr(item, "label", "unknown")
        label = str(getattr(label_value, "value", label_value))
        prov = provenance_of(item)
        text_hash = sha(text)
        ordinal = len(blocks)
        block_id = sha(f"{source_hash}:{ordinal}:{label}:{text_hash}")
        blocks.append({"id": block_id, "ordinal": ordinal, "label": label, "text": text, "text_sha256": text_hash, "level": int(depth), "provenance": prov})
    if not blocks:
        raise ValueError("document produced no text-bearing blocks")

    snapshot = {
        "schema_version": "dwin.document-snapshot/v1",
        "source_id": args.source_id,
        "source_sha256": source_hash,
        "source_bytes": len(source_bytes),
        "parser": "docling",
        "parser_version": docling.__version__,
        "parser_config_hash": args.config_hash,
        "model_artifacts_hash": args.model_hash,
        "page_count": page_count,
        "blocks": blocks,
        "markdown": document.export_to_markdown(),
        "docling_document": document.export_to_dict(coord_precision=4, confid_precision=4),
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
