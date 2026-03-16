# vision-bridge

An [OpenClaw](https://github.com/haiyuzhong1980) plugin that provides cross-channel image understanding — OCR extraction, heuristic vision analysis, and structured data extraction — automatically injected into agent context before the agent turn.

## Features

- **Multi-provider OCR** — PaddleOCR (Python) and macOS Vision Framework with automatic fallback
- **Heuristic vision** — rule-based image classification without requiring a cloud vision API
- **6 image classifications** — `screenshot`, `document`, `photo`, `qrcode`, `chart`, `unknown`
- **Structured extraction** — pulls amounts, dates, items, references from receipts, invoices, and forms
- **Multi-image comparison** — diff and similarity scoring across multiple images in one message
- **Auto-injection** — OCR and vision results are automatically inserted into the agent's context window

## Architecture

```
image received
    │
    ▼
[classify]  → screenshot | document | photo | qrcode | chart | unknown
    │
    ▼
[OCR]  (auto → macos_vision → paddleocr fallback)
    │
    ▼
[refine]  (post-process raw OCR text)
    │
    ▼
[vision extract]  (heuristic structured extraction)
    │
    ▼
[normalize]  (canonical result format)
    │
    ▼
[handoff]  (inject into agent context)
```

## Phase Status

| Phase | Status | Description |
|---|---|---|
| Phase 1 | Complete | Local OCR (PaddleOCR + macOS Vision) + heuristic analysis |
| Phase 2 | Planned | Cloud vision providers (e.g., Google Vision, Azure Computer Vision) |

## Installation

### 1. Copy the plugin

```bash
cp -r vision-bridge ~/.openclaw/extensions/vision-bridge
```

### 2. Set up Python environment for PaddleOCR (optional)

PaddleOCR requires a Python virtual environment. If you plan to use `paddleocr` or `auto` as the OCR provider:

```bash
cd ~/.openclaw/extensions/vision-bridge
python3 -m venv .venv
source .venv/bin/activate
pip install paddlepaddle paddleocr
```

macOS Vision is used by default on Apple Silicon and requires no additional setup.

## Configuration

### openclaw.json plugin config

```json
{
  "plugins": {
    "entries": {
      "vision-bridge": {
        "enabled": true,
        "config": {
          "autoInject": {
            "enabled": true,
            "maxRecentMessages": 8
          },
          "limits": {
            "maxImageBytes": 15728640,
            "maxImageCount": 4,
            "maxSummaryChars": 4000
          },
          "ocr": {
            "provider": "auto",
            "fallbackOrder": ["macos_vision", "paddleocr"],
            "timeoutMs": 30000
          },
          "vision": {
            "provider": "heuristic"
          }
        }
      }
    }
  }
}
```

### OCR providers

| Provider | Description |
|---|---|
| `auto` | Try providers in `fallbackOrder` until one succeeds |
| `macos_vision` | Apple Vision Framework (macOS only, no extra dependencies) |
| `paddleocr` | PaddleOCR via Python subprocess (requires `.venv` setup) |
| `disabled` | Skip OCR entirely |

### Vision providers

| Provider | Description |
|---|---|
| `heuristic` | Rule-based extraction using OCR output and image metadata |
| `disabled` | Skip vision analysis entirely |

## License

MIT
