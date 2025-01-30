const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv").config();
const app = express();
app.use(cors());
app.use(express.json());
const mongoURI = process.env.MONGO_URI;
console.log(mongoURI);
// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.log(err));

// Define a schema for enquiries
const enquirySchema = new mongoose.Schema({
  name: String,
  contact: String,
  date: String,
  interested_model: String,
  location: String,
});

const transcriptSchema = new mongoose.Schema({
  user_info: {
    name: String,
    contact: String,
    date: Date,
    interested_model: String,
    location: String,
  },
  transcript: [String],
});

// Reference the specific collection
const Enquiry = mongoose.model("Enquiry", enquirySchema, "enquiry_details"); // Specify the collection name here
const Transcript =
  mongoose.transcript_details ||
  mongoose.model("transcript_details", transcriptSchema);
const clientModelSchema = new mongoose.Schema({
  _id: mongoose.Schema.Types.ObjectId,
  category: Array,
});

// Reference the client_models collection
const ClientModel = mongoose.model(
  "ClientModel",
  clientModelSchema,
  "client_models"
);

app.get("/api/transcripts", async (req, res) => {
  try {
    console.log("hit");
    const transcripts = await Transcript.find().limit(50);
    res.status(200).json(transcripts);
  } catch (err) {
    console.log(err.message);
  }
});

// API to fetch daily enquiries
app.get("/", (req, res) => {
  res.json({
    status: "ok",
  });
});

app.get("/api/enquiries", async (req, res) => {
  try {
    const enquiries = await Enquiry.aggregate([
      {
        $group: {
          _id: { $substr: ["$date", 0, 10] }, // Group by the date part of the 'date' field
          count: { $sum: 1 }, // Count the number of enquiries per day
        },
      },
      { $sort: { _id: 1 } }, // Sort by date
    ]);

    res.json(
      enquiries.map((entry) => ({ date: entry._id, enquiries: entry.count }))
    );
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.get("/api/models", async (req, res) => {
  try {
    const modelData = await Enquiry.aggregate([
      {
        $group: {
          _id: "$interested_model", // Group by 'interested_model'
          count: { $sum: 1 }, // Count the number of enquiries for each model
        },
      },
      {
        $lookup: {
          from: "client_models", // Name of the collection to join with
          localField: "_id", // Field in the Enquiry collection to match
          foreignField: "_id", // Field in the client_models collection to match
          as: "model_info", // Alias for the joined data
        },
      },
      { $unwind: "$model_info" }, // Unwind the array to get the model info as a single object
      {
        $project: {
          model: "$model_info.model", // Get the 'model' field from 'client_models'
          count: 1, // Retain the count field
        },
      },
      { $sort: { count: -1 } }, // Sort by count in descending order
    ]);

    // Transform the data to match frontend expectations
    res.json(
      modelData.map((entry) => ({
        model: entry.model || "Unknown", // Handle cases where the model might be missing
        count: entry.count,
      }))
    );
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.get("/api/leaderboard/regions", async (req, res) => {
  try {
    const regionLeaderboard = await Enquiry.aggregate([
      {
        $group: {
          _id: "$location", // Group by the 'location' field
          count: { $sum: 1 }, // Count the number of enquiries per region
        },
      },
      { $sort: { count: -1 } }, // Sort by count in descending order
    ]);

    // Transform the data to match frontend expectations
    res.json(
      regionLeaderboard.map((entry) => ({
        region: entry._id || "Unknown", // Handle cases where the location might be missing
        count: entry.count,
      }))
    );
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.get("/api/categories", async (req, res) => {
  try {
    const categoryCounts = await Enquiry.aggregate([
      {
        $lookup: {
          from: "client_models", // Join with client_models collection
          localField: "interested_model", // Match 'interested_model' in Enquiry
          foreignField: "_id", // Match '_id' in client_models
          as: "model_info", // Alias for joined data
        },
      },
      { $unwind: "$model_info" }, // Flatten the model_info array
      { $unwind: "$model_info.category" }, // Flatten the category array
      {
        $group: {
          _id: "$model_info.category", // Group by category
          count: { $sum: 1 }, // Count documents in each category
        },
      },
      { $sort: { count: -1 } }, // Sort by count in descending order
    ]);

    // Transform the data for the radar chart
    res.json(
      categoryCounts.map((entry) => ({
        category: entry._id || "Unknown", // Handle cases where category might be missing
        count: entry.count,
      }))
    );
  } catch (error) {
    console.error("Error fetching categories:", error.message);
    res.status(500).send(error.message);
  }
});

app.get("/api/sales-enquiries", async (req, res) => {
  try {
    const salesEnquiriesData = await Enquiry.aggregate([
      {
        $match: {
          interested_model: { $type: "objectId" }, // Ensure it's an ObjectId
        },
      },
      {
        $group: {
          _id: "$interested_model",
          enquiry_count: { $sum: 1 },
          converted_count: {
            $sum: {
              $cond: [{ $eq: ["$status", "Converted"] }, 1, 0], // Count only converted
            },
          },
        },
      },
      // Lookup model information from `client_models`
      {
        $lookup: {
          from: "client_models",
          localField: "_id",
          foreignField: "_id",
          as: "model_info",
        },
      },
      // Flatten the model_info array
      { $unwind: "$model_info" },
      // Project the required fields
      {
        $project: {
          model: "$model_info.model",
          enquiry_count: 1,
          converted_count: 1,
        },
      },
      // Sort by enquiries in descending order
      { $sort: { enquiry_count: -1 } },
    ]);

    // Transform data to match frontend format
    res.json(
      salesEnquiriesData.map((entry) => ({
        model: entry.model || "Unknown",
        enquiry_count: entry.enquiry_count,
        converted_count: entry.converted_count,
      }))
    );
  } catch (error) {
    console.error("Error fetching sales vs enquiries data:", error.message);
    res.status(500).send(error.message);
  }
});

const PORT = 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
