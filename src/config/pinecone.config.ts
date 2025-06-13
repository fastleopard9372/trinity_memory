import { Pinecone } from '@pinecone-database/pinecone';

export const createPineconeClient = async () => {
    const pinecone = await new Pinecone({
        apiKey: process.env.PINECONE_API_KEY!
    });

    async function initPinecone() {
        const existingIndexes = await pinecone.listIndexes();
        
        const indexExists = existingIndexes.indexes?.some(
          (index) => index.name === process.env.PINECONE_INDEX_NAME
        );
        if (indexExists) {
          console.log(`✅ Index "${process.env.PINECONE_INDEX_NAME!}" already exists.`);
        } else {
          console.log(`📦 Creating index "${process.env.PINECONE_INDEX_NAME}"...`);
          await pinecone.createIndex({
            name: process.env.PINECONE_INDEX_NAME!,
            dimension: 1536,
            spec: {
              serverless:{region:process.env.PINECONE_ENVIRONMENT!, cloud:"aws"}
            }
          });
          console.log(`✅ Index "${process.env.PINECONE_INDEX_NAME}" created.`);
        }
      
        return pinecone.Index(process.env.PINECONE_INDEX_NAME!);
      }
      
      initPinecone().catch((err) => {
        console.error("❌ Failed to initialize Pinecone:", err);
      });
    return pinecone;
};