# Local model setup

Nix currently connects to an already-running llama.cpp HTTP server. It never falls back to a hosted provider.

## 1. Obtain llama.cpp

Install a current Windows build with `winget install llama.cpp`, or download a Windows CUDA build
from the [official llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases). Keep the
program outside this repository if preferred. Depending on the package, the command is `llama
serve` or the executable is `llama-server.exe`.

## 2. Obtain a coding model

Download a GGUF quantization of an open-weight coding model that fits the workstation's quality and
memory requirements. Model downloads are intentionally manual because weights are large and
licensing/hardware tradeoffs should be reviewed first.

The recommended first live test is Mistral's official
[`Devstral-Small-2507-Q4_K_M.gguf`](https://huggingface.co/mistralai/Devstral-Small-2507_gguf).
It is a 24B coding model with function-calling support; its Q4 file is approximately 14.3 GB. That is
close enough to the RTX 5080's 16 GB VRAM limit that context memory and runtime overhead matter, so
start with a 16K context and automatic CPU/GPU placement. The 64 GB of system RAM provides room for
partial offload. This is a validation starting point, not a hard-coded Nix dependency.

Qwen coding GGUFs remain valid candidates. Test one after the initial protocol is known to work so
model-quality differences are not confused with setup problems.

## 3. Start the server

From PowerShell, adapt these paths and GPU layers to the installed build and selected model:

```powershell
& 'C:\path\to\llama-server.exe' --model 'C:\path\to\Devstral-Small-2507-Q4_K_M.gguf' --alias local-coding-model --host 127.0.0.1 --port 8080 --n-gpu-layers auto --ctx-size 16384 --jinja
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

Continue with the staged exercise in [MANUAL_TESTING.md](MANUAL_TESTING.md). Do not start with a real
project: first prove the protocol against the disposable fixture.
