FROM mcr.microsoft.com/playwright:v1.47.0-jammy
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/
RUN uv run -q --no-project --with playwright==1.47.0 python -c "import playwright"
