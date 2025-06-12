import { config } from "dotenv";

config()

const setting = { 
    app_port: 3000,
    
    openai_api_key: process.env.OPENAI_API_KEY,
    
    pinecone_api_key: process.env.PINECONE_API_KEY,
    pinecone_environment: process.env.PINECONE_ENVIRONMENT,
    pinecone_index_name: process.env.PINECONE_INDEX_NAME,

    nas_username: process.env.NAS_USERNAME,
    nas_password: process.env.NAS_PASSWORD,
    nas_base_path: process.env.NAS_BASE_PATH
}

export default setting;