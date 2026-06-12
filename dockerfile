# Stage 1: Build the React client
FROM node:20-alpine AS client-builder
WORKDIR /build

# Copy client dependencies and install
COPY client/package*.json ./
RUN npm install

# Copy client source and build
COPY client/ ./
RUN npm run build

# Stage 2: Serve the application with the Express server
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy server package manifest and install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy server source code and support scripts
COPY server.js firebaseAdmin.js ./
COPY server/ ./server/

# Copy the built client assets from stage 1
COPY --from=client-builder /build/dist ./client/dist

# Expose port and run the server
EXPOSE 3000
ENV PORT=3000

CMD ["node", "server.js"]
