#!/usr/bin/env node
import dotenv from "dotenv";
dotenv.config();

import app from "./app.js";
import { connectDatabase, DB_NAME } from "./lib/db.js";

const port = process.env.PORT || 5000;

async function start() {
  try {
    await connectDatabase();

    console.log(`MongoDB connected (dbName=${DB_NAME})`);

    const listener = app.listen(port, () => {
      console.log(`Server running on port: ${port}`);
    });

    // optional clean shutdown
    process.on("SIGINT", () => {
      listener.close(() => process.exit(0));
    });
  } catch (err) {
    console.error("Startup failed:", err);
    process.exit(1);
  }
}

start();
