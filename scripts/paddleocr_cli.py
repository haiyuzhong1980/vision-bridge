#!/usr/bin/env python3

import logging
logging.disable(logging.DEBUG)
import os
os.environ['PPOCR_LOG_LEVEL'] = 'ERROR'
os.environ.setdefault("DISABLE_MODEL_SOURCE_CHECK", "True")
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")

import json
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "missing_path"}), file=sys.stderr)
        return 2

    image_path = sys.argv[1]

    try:
        from paddleocr import PaddleOCR
    except Exception as exc:  # pragma: no cover
        print(json.dumps({"error": "import_failed", "message": str(exc)}), file=sys.stderr)
        return 3

    try:
        ocr = PaddleOCR(use_textline_orientation=False, lang="ch")
        result = ocr.predict(image_path)
        item = result[0]
        payload = getattr(item, "json", {}) or {}
        texts = payload.get("rec_texts", []) or []
        scores = payload.get("rec_scores", []) or []
        lines = []
        for index, text in enumerate(texts):
          if not isinstance(text, str):
            continue
          score = scores[index] if index < len(scores) else None
          lines.append({"text": text, "score": score})

        merged = "\n".join(text for text in texts if isinstance(text, str) and text.strip())
        print(
            json.dumps(
                {
                    "provider": "paddleocr",
                    "text": merged,
                    "lines": lines,
                },
                ensure_ascii=False,
            )
        )
        return 0
    except Exception as exc:
        print(json.dumps({"error": "ocr_failed", "message": str(exc)}), file=sys.stderr)
        return 4


if __name__ == "__main__":
    raise SystemExit(main())
