FROM node:16.18.1
WORKDIR /app

# Setup node
COPY package.json package.json
COPY package-lock.json package-lock.json
RUN npm ci

# Setup app
COPY . .

# VOLUME ["/app/db/", "/app/config.ini"]
CMD ["npm", "start"]