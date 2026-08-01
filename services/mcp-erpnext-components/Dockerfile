FROM denoland/deno:2.9.2

WORKDIR /app

COPY deno.json deno.lock ./
COPY component-contract.ts mod.ts server.ts ./
COPY ui/dist ./ui/dist

RUN deno cache --frozen --allow-import server.ts

USER deno
EXPOSE 3017

CMD ["run", "--allow-env", "--allow-net", "--allow-read=ui/dist,mcp-server.yaml", "server.ts", "--http", "--port=3017", "--hostname=0.0.0.0"]
