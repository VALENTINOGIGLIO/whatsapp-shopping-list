FROM node:20-slim

# Install system chromium and font dependencies via apt-get
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    --no-install-recommends \
 && rm -rf /var/lib/apt/lists/*

# Set Puppeteer environment variables
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    PORT=3000

WORKDIR /usr/src/app

# Copy package definition files and install production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application source code
COPY . .

EXPOSE 3000

CMD ["npm", "start"]
