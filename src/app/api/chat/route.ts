import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: "eu-west-1",
});

async function uploadImageToS3(
  image: Blob | Buffer,
  chatId: string,
  imageName: string
): Promise<string> {
  const Bucket = "omri-zaher-yolo";
  const Key = `${chatId}/original/${imageName}`;

  // Detect content type from imageName extension
  let ContentType = "application/octet-stream";
  if (imageName.endsWith(".jpg") || imageName.endsWith(".jpeg")) {
    ContentType = "image/jpeg";
  } else if (imageName.endsWith(".png")) {
    ContentType = "image/png";
  }
  const arrayBuffer = await image.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  const command = new PutObjectCommand({
    Bucket,
    Key,
    Body: uint8Array,
    ContentType,
  });

  await s3.send(command);

  return `https://${Bucket}.s3.amazonaws.com/${Key}`;
}

export async function POST(req: Request) {
  // Destructure request data
  const { messages, selectedModel, data } = await req.json();
  // Extract image name and chat id from data
  const imageName = data?.imageName;
  const chatId = data?.chatId;

  // Remove experimental_attachments from each message
  const cleanedMessages = messages.map((message: any) => {
    const { experimental_attachments, ...cleanMessage } = message;
    return cleanMessage;
  });

  let message = "Please provide an image for object detection.";

  // Check if there are images for object detection
  if (data?.images && data.images.length > 0) {
    try {
      // Handle object detection for the first image
      const imageUrl = data.images[0];

      // Convert data URL to blob for upload
      const response = await fetch(imageUrl);
      const blob = await response.blob();

      try {
        await uploadImageToS3(blob, chatId, imageName || "image.jpg");
      } catch (err) {
        throw new Error(
          "S3_ERROR: " +
            (err instanceof Error ? err.message : "Unknown S3 upload error")
        );
      }
      // Create FormData for the prediction API
      const formData = new FormData();
      formData.append("file", blob, imageName || "image.jpg");

      // Build YOLO service URL with query params
      const yoloUrl = `http://${
        process.env.ENV === "development"
          ? process.env.YOLO_SERVICE_DEV
          : process.env.YOLO_SERVICE
      }/predict?img_name=${encodeURIComponent(
        imageName || "image.jpg"
      )}&chat_id=${encodeURIComponent(chatId || "")}`;

      // Call the object detection API
      const predictionResponse = await fetch(yoloUrl, {
        method: "POST",
        body: formData,
      });

      if (!predictionResponse.ok) {
        throw new Error(`Prediction API error: ${predictionResponse.status}`);
      }

      const predictionResult = await predictionResponse.json();

      // Format the detection results for chat
      message = `🔍 **Object Detection Results**

          **Detection Count:** ${predictionResult.detection_count}
          **Detected Objects:** ${predictionResult.labels.join(", ")}
          **Prediction ID:** ${predictionResult.prediction_uid}

          detected ${predictionResult.detection_count} object(s). 
           The detected objects include: ${predictionResult.labels.join(
             ", "
           )}.`;
    } catch (error) {
      console.error("Object detection error:", error);
      if (
        error instanceof Error &&
        typeof error.message === "string" &&
        error.message.startsWith("S3_ERROR:")
      ) {
        message = "Upload to S3 failed. Please try again.";
      } else {
        message = `❌ **Object Detection Error**
            Sorry, I encountered an error while processing your image: ${
              error instanceof Error ? error.message : "Unknown error"
            }
  
            Please make sure the object detection service is running on localhost:8080.`;
      }
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Split message into lines and send each line as a separate chunk
      const lines = message.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Add newline character back except for the last line
        const content = i < lines.length - 1 ? line + "\n" : line;
        controller.enqueue(encoder.encode(`0:${JSON.stringify(content)}\n`));
      }

      // Send finish event
      controller.enqueue(
        encoder.encode(
          `e:${JSON.stringify({
            finishReason: "stop",
            usage: { promptTokens: 10, completionTokens: message.length },
            isContinued: false,
          })}\n`
        )
      );

      // Send done event
      controller.enqueue(
        encoder.encode(
          `d:${JSON.stringify({
            finishReason: "stop",
            usage: { promptTokens: 10, completionTokens: message.length },
          })}\n`
        )
      );

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Vercel-AI-Data-Stream": "v1",
    },
  });
}
