FROM node:24-alpine

# SETUP npm
RUN npm config set engine-strict true
RUN npm install -g npm@latest

# INSTALL PACKAGES
WORKDIR /app
ENV NODE_ENV=PRODUCTION
COPY package*.json .
RUN npm ci

# INSTALL APP
COPY app.js .
COPY src/ src/

# SECURITY CHECK
RUN chown -R node:node /app
USER node

CMD ["npm","run","prod"]