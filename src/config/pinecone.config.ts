import { Pinecone } from '@pinecone-database/pinecone';

export const createPineconeClient = async () => {
    const pinecone = await new Pinecone({
        apiKey: process.env.PINECONE_API_KEY!,
        environment: process.env.PINECONE_ENVIRONMENT!
    });
    return pinecone;
};