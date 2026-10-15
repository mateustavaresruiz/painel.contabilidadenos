# Painel Denos (front) — build com Node, servido pelo nginx.
# No Easypanel: Dockerfile = apps/web/Dockerfile, contexto = apps/web, e os
# build args VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. O Vite embute as
# VITE_* no bundle NA HORA DO BUILD: mudar a URL ou a chave exige novo build.
# (A anon key é pública por natureza; segredo de verdade não entra aqui.)

FROM node:20-alpine AS build
WORKDIR /app

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN test -n "$VITE_SUPABASE_URL" && test -n "$VITE_SUPABASE_ANON_KEY" \
    || (echo "Faltam os build args VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY" && exit 1)
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz || exit 1
