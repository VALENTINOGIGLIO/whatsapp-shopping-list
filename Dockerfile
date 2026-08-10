FROM node:20-slim

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /usr/src/app

# Copy package definition files and install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source code
COPY . .

EXPOSE 3000

CMD ["npm", "start"]
