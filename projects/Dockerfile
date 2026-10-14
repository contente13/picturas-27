from node
workdir /app

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

copy . .
run npm install

expose 9001
cmd ["npm", "start"]
