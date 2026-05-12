FROM node:20-alpine AS builder

ARG VITE_BACKEND_URL=http://localhost:8000
ARG VITE_BACKEND_WS_URL=ws://localhost:8000

WORKDIR /app

COPY package-lock.json package.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
