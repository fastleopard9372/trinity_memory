import { config } from "dotenv";
import { Pinecone } from "@pinecone-database/pinecone";
import { OpenAIEmbeddings } from "@langchain/openai";
import { PineconeStore } from "@langchain/community/vectorstores/pinecone";
import { Document } from "@langchain/core/documents";

config();

// 1. Initialize Pinecone
const pinecone = new Pinecone();
const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME!);

// 2. Initialize OpenAI Embeddings
const embeddings = new OpenAIEmbeddings({
  openAIApiKey: process.env.OPENAI_API_KEY!,
});

// 3. Create the Vector Store
async function run() {
  const docs = [
    new Document({
      pageContent: "Pinecone is a vector database.",
      metadata: { source: "doc1" },
    }),
    new Document({
      pageContent: "LangChain helps connect language models to data.",
      metadata: { source: "doc2" },
    }),
  ];

  // Upsert to Pinecone
  const vectorStore = await PineconeStore.fromDocuments(docs, embeddings, {
    pineconeIndex,
  });

  // 4. Query the vector store
  const results = await vectorStore.similaritySearch("What is Pinecone and work to be relative about it?", 1);
  console.log("🔍 Search Result:", results);
}

run().catch(console.error);