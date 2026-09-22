# Local model setup

Nix currently connects to an already-running llama.cpp HTTP server. It never falls back to a hosted provider.

## 1. Obtain llama.cpp

Install a current Windows build with `winget install llama.cpp`, or download a Windows CUDA build
from the [official llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases). Keep the
program outside this repository if preferred. Depending on the package, the command is `llama
serve` or the executable is `llama-server.exe`.

## 2. Choose a current coding model

Download a GGUF quantization of an open-weight coding model that fits the workstation's quality and
memory requirements. Model downloads are intentionally manual because weights are large and
licensing/hardware tradeoffs should be reviewed first.

Current candidates, in a practical initial test order, are:

1. **Qwen3-Coder-30B-A3B-Instruct** — the preferred first protocol test. It is a coding-focused MoE
   model with 30B total and roughly 3B active parameters. Use a reputable GGUF conversion at a
   quantization that leaves context/runtime headroom; the official
   [Qwen model card](https://huggingface.co/Qwen/Qwen3-Coder-30B-A3B-Instruct) is the source model.
2. **Devstral Small 2 24B Instruct 2512** — the dense-model comparison candidate. The official
   [Mistral source model](https://huggingface.co/mistralai/Devstral-Small-2-24B-Instruct-2512) and a
   [llama.cpp GGUF conversion](https://huggingface.co/ggml-org/Devstral-Small-2-24B-Instruct-2512-GGUF)
   are available. The ggml-org repository currently exposes Q8, which needs substantial RAM
   offload; a reviewed Q4_K_M community conversion is more practical for the first 16 GB VRAM test.
3. **Qwen3-Coder-Next** — an optional heavier benchmark after the basic loop works. The official
   [model](https://huggingface.co/Qwen/Qwen3-Coder-Next) has 80B total/3B active parameters and an
   official [GGUF repository](https://huggingface.co/Qwen/Qwen3-Coder-Next-GGUF). Its much larger
   stored weights make it a system-RAM/offload test, not the fastest setup-validation choice.

Do not infer quality from parameter count alone. Record tool-call correctness, edit quality,
tokens/second, memory use, and failure modes on the same fixture before choosing a default. Nix only
sees the configured `ModelProvider`; no behavior is hard-coded for any candidate.

For the RTX 5080 with 16 GB VRAM and 64 GB system RAM, begin with a Q4-class quantization, a 16K
context, and automatic CPU/GPU fitting. Increase context only after measuring VRAM and prompt speed.
Review the chosen conversion's model card and license before downloading it.

## 3. Start the server

From PowerShell, adapt these paths and GPU layers to the installed build and selected model:

```powershell
& 'C:\path\to\llama-server.exe' --model 'C:\path\to\selected-coding-model.gguf' --alias local-coding-model --host 127.0.0.1 --port 8080 --n-gpu-layers auto --ctx-size 16384 --jinja
```

If WinGet installed the newer command wrapper, use the equivalent `llama serve` command. Binding to
`127.0.0.1` keeps the endpoint local. Current llama.cpp builds support automatic GPU-layer fitting,
and Jinja chat templates enable the model's tool-call formatting. Exact flags can change; check
`llama-server.exe --help` or `llama serve --help` for the installed build.

## 4. Verify Nix connectivity

```powershell
npm run dev -- model health
npm run dev -- prompt 'Reply with exactly: local model ready'
```

Configuration can be supplied with environment variables:

```powershell
$env:NIX_MODEL_ENDPOINT = 'http://127.0.0.1:8080'
$env:NIX_MODEL_NAME = 'local-coding-model'
```

Or create an ignored `nix.config.json`:

```json
{
  "model": {
    "endpoint": "http://127.0.0.1:8080",
    "name": "local-coding-model",
    "requestTimeoutMs": 120000
  }
}
```

Nix uses llama.cpp's OpenAI-compatible `/v1/chat/completions` route and `/health`. A connection failure is reported as `MODEL_UNAVAILABLE`; no repository data is sent elsewhere.

Agent runs stop before the accumulated request exceeds `NIX_CONTEXT_CHARACTER_LIMIT` (default
120000 characters). This is a conservative transport-independent estimate, not an exact tokenizer
count. For the 16K startup context, use the small fixture first and inspect `context_usage` events in
the local task log before tuning this value.

Continue with the staged exercise in [MANUAL_TESTING.md](MANUAL_TESTING.md). Do not start with a real
project: first prove the protocol against the disposable fixture.
