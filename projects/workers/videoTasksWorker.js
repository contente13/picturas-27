const mongoose = require("mongoose");
const amqp = require("amqplib");
const { processTask } = require("../controllers/videoTasks");

const mongoUrl = process.env.MONGO_URL || "mongodb://projects_mongoDB:27018/project";
const rabbitUrl = process.env.RABBITMQ_URL || "amqp://user:password@rabbitmq:5672";
const queue = "video.trim.tasks";

async function start() {
  await mongoose.connect(mongoUrl);
  const connection = await amqp.connect(rabbitUrl);
  connection.on("close", () => process.exit(1));
  const channel = await connection.createChannel();
  await channel.assertQueue(queue, { durable: true });
  channel.prefetch(1);
  await channel.consume(queue, async (message) => {
    if (!message) return;
    try {
      const payload = JSON.parse(message.content.toString("utf8"));
      await processTask(payload.taskId);
      channel.ack(message);
    } catch (error) {
      console.error("Video tasks worker error:", error);
      channel.nack(message, false, true);
    }
  }, { noAck: false });
  console.log(`Video tasks worker listening on ${queue}`);
}

start().catch((error) => {
  console.error("Could not start video tasks worker:", error);
  process.exit(1);
});
