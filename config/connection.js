import mongoose from "mongoose";

const fallbackUri = "mongodb://127.0.0.1:27017/musicapp";

export const connectMongo = async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || fallbackUri;
  mongoose.set("strictQuery", true);

  try {
    const conn = await mongoose.connect(uri, { autoIndex: true });

    const db = conn.connection.db;
    console.log("✅ MongoDB connected successfully!");
    console.log("📦 Database:", db.databaseName);

    // Optional: list all collections
    const collections = await db.listCollections().toArray();
    console.log(
      "🗂️ Collections:",
      collections.length
        ? collections.map((c) => c.name).join(", ")
        : "(none yet — will be created on first insert)"
    );

    return conn.connection;
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    process.exit(1);
  }
};
