# docs/

Two reports on the September 2026 backend audit, as PDFs and as their HTML
sources.

| File | For | Pages |
|---|---|---:|
| `audit-report.pdf` | Anyone who needs to know what was wrong and what it would have cost. Plain English, no code. | 8 |
| `test-register.pdf` | Whoever continues the test work — which endpoints are covered, which are left, and the pattern to follow. | 7 |

`TEST-COVERAGE.md` in the repo root carries the same register in Markdown, which
is what a future session will actually read.

## Regenerating

The `.html` files are the source. To rebuild the PDFs after editing one:

```bash
chrome --headless=new --disable-gpu --no-sandbox \
  --user-data-dir=<a scratch dir> --no-first-run --no-pdf-header-footer \
  --print-to-pdf="<absolute output path>.pdf" \
  "file:///<absolute path>.html"
```

Two things that make this fail silently on Windows, both learned the hard way:
Chrome writes nothing and still exits 0 if `--user-data-dir` points at a profile
another Chrome already holds, so always pass a scratch one; and `--print-to-pdf`
needs an absolute path.

The pages print cleanly — sections and table rows are set not to break across
page boundaries.
