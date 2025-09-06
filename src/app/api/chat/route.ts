

// route.ts

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { routeModule } from 'next/dist/build/templates/app-page';



const s3 = new S3Client({ region:'eu-west-1'});


export async function POST(req: Request) {
  const { messages, selectedModel, data } = await req.json();

  const cleanedMessages = Array.isArray(messages)
    ? messages.map((m: any) => {
        const { experimental_attachments, ...rest } = m ?? {};
        return rest;
      })
    : [];

  let message = 'Please provide an image for object detection.';

  if (data?.images?.length) {
    try {
      const bucket = process.env.AWS_S3_BUCKET!;
      const yoloService = "http://yolo:8081";
      // const yoloService = process.env.YOLO_SERVICE ||  "http://localhost:8081";

      if (!bucket || !yoloService) {
        throw new Error('Missing AWS_S3_BUCKET or YOLO_SERVICE env');
      }


      const imageUrl: string = data.images[0];
      const resp = await fetch(imageUrl);
      if (!resp.ok) throw new Error(`Failed to fetch uploaded image: ${resp.status}`);
      const blob = await resp.blob();
      // console.log("******")
      // console.log(blob.type)
      const contentType = blob.type || 'application/octet-stream';
      const arrBuf = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrBuf);
      // const body = Buffer.from(arrBuf);
  
      const prefix = "randomprefix";
      // const ext = extFromContentType(contentType) || 'bin';
      const key = `${prefix}${randomUUID()}`;

      // העלאה ל-S3
      try{
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: uint8Array,
            ContentType: contentType,
          }),
        );
      }catch(error){
        throw new Error(
          "S3_ERROR: " +
            (error instanceof Error ? error.message : "Unknown S3 upload error")
        );
      }

      const predictionResponse = await fetch(
        `${yoloService.replace(/\/+$/, '')}/predict?img_url=${encodeURIComponent(key)}`,
        { method: 'POST' },
      );

      if (!predictionResponse.ok) {
        const text = await predictionResponse.text().catch(() => '');
        throw new Error(`Prediction API error: ${predictionResponse.status} ${text}`);
      }

      const predictionResult = await predictionResponse.json();

      message = `🔍 **Object Detection Results**

**Detection Count:** ${predictionResult.detection_count}
**Detected Objects:** ${Array.isArray(predictionResult.labels) ? predictionResult.labels.join(', ') : ''}
**Prediction ID:** ${predictionResult.prediction_uid}

I've analyzed your image and detected ${predictionResult.detection_count} object(s). The detected objects include: ${
        Array.isArray(predictionResult.labels) ? predictionResult.labels.join(', ') : ''
      }.`;      
    } catch (error) {
      console.error('Object detection error:', error);
      message = `❌ **Object Detection Error**

${error instanceof Error ? error.message : 'Unknown error'}

Tips:
- ודא של-YOLO יש משתני סביבה נכונים ל-S3 (AWS_REGION, AWS_S3_BUCKET, הרשאות).
- ודא שה־YOLO מאזין ב: ${process.env.YOLO_SERVICE || process.env.YOLO_SERVICE_DEV || 'http://localhost:8080'}.
`;
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const lines = message.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const content = i < lines.length - 1 ? lines[i] + '\n' : lines[i];
        controller.enqueue(encoder.encode(`0:${JSON.stringify(content)}\n`));
      }
      controller.enqueue(
        encoder.encode(
          `e:${JSON.stringify({
            finishReason: 'stop',
            usage: { promptTokens: 10, completionTokens: message.length },
            isContinued: false,
          })}\n`,
        ),
      );
      controller.enqueue(
        encoder.encode(
          `d:${JSON.stringify({
            finishReason: 'stop',
            usage: { promptTokens: 10, completionTokens: message.length },
          })}\n`,
        ),
      );
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















// // route.ts
// import { createOllama } from 'ollama-ai-provider';
// import { streamText, convertToCoreMessages, CoreMessage, UserContent } from 'ai';

// import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
// import { routeModule } from 'next/dist/build/templates/app-page';



// export const runtime = "edge";
// export const dynamic = "force-dynamic";


// export async function POST(req: Request) {
//   // Destructure request data
//   const { messages, selectedModel, data } = await req.json();

//   // Remove experimental_attachments from each message
//   const cleanedMessages = messages.map((message: any) => {
//     const { experimental_attachments, ...cleanMessage } = message;
//     return cleanMessage;
//   });

//   let message = 'Please provide an image for object detection.';
 
//   // Check if there are images for object detection
//   if (data?.images && data.images.length > 0) {
//     try {
//       // Handle object detection for the first image
//       const imageUrl = data.images[0];
      
//       // Convert data URL to blob for upload
//       const response = await fetch(imageUrl);
//       const blob = await response.blob();
      
//       // Create FormData for the prediction API
//       const formData = new FormData();
//       formData.append('file', blob, 'image.jpg');
      
//       // Call the object detection API
//       const predictionResponse = await fetch(`${process.env.YOLO_SERVICE_DEV}/predict`, {
//         method: 'POST',
//         body: formData,
//       });
      
//       if (!predictionResponse.ok) {
//         throw new Error(`Prediction API error: ${predictionResponse.status}`);
//       }
      
//       const predictionResult = await predictionResponse.json();
      
//       // Format the detection results for chat
//       message = `🔍 **Object Detection Results**

// **Detection Count:** ${predictionResult.detection_count}
// **Detected Objects:** ${predictionResult.labels.join(', ')}
// **Prediction ID:** ${predictionResult.prediction_uid}

// I've analyzed your image and detected ${predictionResult.detection_count} object(s). The detected objects include: ${predictionResult.labels.join(', ')}.`;
    
//     } catch (error) {
//       console.error('Object detection error:', error);
//       message = `❌ **Object Detection Error**

// Sorry, I encountered an error while processing your image: ${error instanceof Error ? error.message : 'Unknown error'}

// Please make sure the object detection service is running on localhost:8080.`;
//      }
//   }

//   const encoder = new TextEncoder();
//   const stream = new ReadableStream({
//     start(controller) {
//       // Split message into lines and send each line as a separate chunk
//       const lines = message.split('\n');
      
//       for (let i = 0; i < lines.length; i++) {
//         const line = lines[i];
//         // Add newline character back except for the last line
//         const content = i < lines.length - 1 ? line + '\n' : line;
//         controller.enqueue(encoder.encode(`0:${JSON.stringify(content)}\n`));
//       }
      
//       // Send finish event
//       controller.enqueue(encoder.encode(`e:${JSON.stringify({
//         finishReason: "stop",
//         usage: { promptTokens: 10, completionTokens: message.length },
//         isContinued: false
//       })}\n`));
      
//       // Send done event
//       controller.enqueue(encoder.encode(`d:${JSON.stringify({
//         finishReason: "stop",
//         usage: { promptTokens: 10, completionTokens: message.length }
//       })}\n`));
      
//       controller.close();
//     },
//   });

//   return new Response(stream, {
//     headers: {
//       'Content-Type': 'text/plain; charset=utf-8',
//       'X-Vercel-AI-Data-Stream': 'v1',
//     },
//   });
// }