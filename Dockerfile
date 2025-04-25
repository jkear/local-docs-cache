# Use an official Node.js runtime as a parent image
FROM node:lts-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (or npm-shrinkwrap.json)
COPY package*.json ./

# Install dependencies using npm ci for a clean install based on lock file
RUN npm ci --only=production

# Copy the rest of the application source code
COPY . .

# Build the TypeScript code
RUN npm run build

# Make port 8000 available to the world outside this container (Standard MCP port)
EXPOSE 8000

# Define the command to run the app
CMD [ "npm", "start" ]