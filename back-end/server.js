#!/usr/bin/env node
import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import app from "./app.js";

const port = process.env.PORT || 5000;

async function start() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      dbName: "bookbroker",
    });

    console.log("MongoDB connected (dbName=bookbroker)");

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
