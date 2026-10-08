FROM node:24.14.1-alpine AS base
WORKDIR /app
COPY package.json package-lock.json* ./

FROM base AS development
RUN npm install
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]

FROM base AS build
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.29.4-alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

