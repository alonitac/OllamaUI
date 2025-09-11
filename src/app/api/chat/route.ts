import { createOllama } from 'ollama-ai-provider';
import { streamText, convertToCoreMessages, CoreMessage, UserContent } from 'ai';
//export const runtime = "edge";
export const dynamic = "force-dynamic";
import { uploadFileToS3 } from "../upload-to-s3/s3";
import amqp from "amqplib";
import { th } from 'zod/v4/locales';
export async function POST(req: Request) {
  
  // Destructure request data
  const { messages, data, id } = await req.json();
  
  // Remove experimental_attachments from each message
  const cleanedMessages = messages.map((message: any) => {
    const { experimental_attachments, ...cleanMessage } = message;
    return cleanMessage;
  });

  let message = 'Please provide an image for object detection.';
 
  // Check if there are images for object detection
  if (data?.images && data.images.length > 0) {
    try {
      // Handle object detection for the first image
      const imageUrl = data.images[0];
      // Convert data URL to blob for upload
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const timestamp = Date.now();
      const imgKey = `image${timestamp}.jpg`;
      const bucketName = process.env.S3_BUCKET!;
      const upload_to_s = await uploadFileToS3(bucketName, imgKey, blob);
      if (!upload_to_s) {
        throw new Error("upload to s3 failed");
      }

      // --- RabbitMQ integration ---
      const rabbitUrl = process.env.RABBITMQ_URL || "amqp://localhost";
      const connection = await amqp.connect(rabbitUrl);
      const channel = await connection.createChannel();
      const queue = "predict";
      await channel.assertQueue(queue, { durable: true });
      const msg = JSON.stringify({
        chat_id: id,
        img: imgKey,
        bucket: bucketName,
        // add more fields if needed
      });
      channel.sendToQueue(queue, Buffer.from(msg), { persistent: true });
      setTimeout(() => {
        channel.close();
        connection.close();
      }, 500);
      message = `� Prediction request sent for chat_id: ${id}, image: ${imgKey}. Please wait for results.`;
    } catch (error) {
      message = `❌ **Object Detection Error**\n\nSorry, I encountered an error while processing your image: ${error instanceof Error ? error.message : 'Unknown error'}\n\nPlease make sure the object detection service and RabbitMQ are running.`;
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Split message into lines and send each line as a separate chunk
      const lines = message.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Add newline character back except for the last line
        const content = i < lines.length - 1 ? line + '\n' : line;
        controller.enqueue(encoder.encode(`0:${JSON.stringify(content)}\n`));
      }
      
      // Send finish event
      controller.enqueue(encoder.encode(`e:${JSON.stringify({
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: message.length },
        isContinued: false
      })}\n`));
      
      // Send done event
      controller.enqueue(encoder.encode(`d:${JSON.stringify({
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: message.length }
      })}\n`));
      
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Vercel-AI-Data-Stream': 'v1',
    },
  });
}
