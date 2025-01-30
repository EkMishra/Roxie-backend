const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

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
const Enquiry = mongoose.model('Enquiry', enquirySchema, 'enquiry_details'); // Specify the collection name here
const Transcript =
  mongoose.transcript_details ||
  mongoose.model("transcript_details", transcriptSchema);

const clientModelSchema = new mongoose.Schema({
    _id: mongoose.Schema.Types.ObjectId,
    category: Array,
});

// Reference the client_models collection
const ClientModel = mongoose.model('ClientModel', clientModelSchema, 'client_models');

app.get("/api/transcripts", async (req, res) => {
  try {
    console.log("hit");
    const transcripts = await Transcript.find().limit(50);
    res.status(200).json(transcripts);
  } catch (err) {
    console.log(err.message);
  }
});

app.get("/", (req, res) => {
  console.log("working")
  res.json({
    status: "ok",
  });
});

// API to fetch daily enquiries
app.get('/api/enquiries', async (req, res) => {
    const { filter, value } = req.query;

    try {
        let matchStage = {};
        let groupStage = {};
        let formatDate = "";

        if (filter === "month") {
            matchStage = {
                $expr: {
                    $eq: [{ $dateToString: { format: "%Y-%m", date: "$date" } }, value],
                },
            };
            groupStage = {
                _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
                count: { $sum: 1 },
            };
            formatDate = "%Y-%m-%d";
        } else if (filter === "year") {
            matchStage = {
                $expr: {
                    $eq: [{ $year: "$date" }, parseInt(value)],
                },
            };
            groupStage = {
                _id: { $month: "$date" },
                count: { $sum: 1 },
            };
            formatDate = "%B"; // Full month name
        }

        const enquiries = await Enquiry.aggregate([
            { $match: matchStage },
            { $group: groupStage },
            { $sort: { _id: 1 } },
        ]);

        res.json(
            enquiries.map(entry => ({
                date: entry._id,
                enquiries: entry.count,
            }))
        );
    } catch (error) {
        res.status(500).send(error.message);
    }
});

app.get('/api/models', async (req, res) => {
    try {
        const { filter, value } = req.query;
        let matchStage = {};

        // Extract year and month for filtering
        if (filter === 'year' && value) {
            const year = parseInt(value);
            matchStage = { date: { $gte: new Date(`${year}-01-01`), $lt: new Date(`${year + 1}-01-01`) } };
        } else if (filter === 'month' && value) {
            const [year, month] = value.split('-').map(Number);
            matchStage = { 
                date: { 
                    $gte: new Date(year, month - 1, 1), 
                    $lt: new Date(year, month, 1) 
                } 
            };
        }

        console.log("Received Filter:", filter);
        console.log("Received Value:", value);
        console.log("Match Stage:", JSON.stringify(matchStage));

        const modelData = await Enquiry.aggregate([
            { $match: matchStage }, // Apply filtering
            {
                $group: {
                    _id: "$interested_model",
                    count: { $sum: 1 },
                },
            },
            {
                $lookup: {
                    from: "client_models",
                    localField: "_id",
                    foreignField: "_id",
                    as: "model_info"
                }
            },
            { $unwind: "$model_info" },
            {
                $project: {
                    model: "$model_info.model",
                    count: 1,
                }
            },
            { $sort: { count: -1 } },
        ]);

        console.log("API Response:", modelData);

        res.json(modelData.map(entry => ({
            model: entry.model || "Unknown",
            count: entry.count,
        })));
    } catch (error) {
        console.error("API Error:", error.message);
        res.status(500).send(error.message);
    }
});

app.get('/api/leaderboard/regions', async (req, res) => {
    const { filter, value } = req.query;
  
    try {
      // Check if filter and value are provided
      if (!filter || !value) {
        return res.status(400).json({ message: 'Filter and value are required' });
      }
  
      // Prepare the match stage to filter based on year or month
      let matchStage = {};
  
      if (filter === 'year') {
        // Filter by year (assuming 'date' field stores the enquiry date)
        matchStage = { "date": { $gte: new Date(`${value}-01-01`), $lt: new Date(`${parseInt(value) + 1}-01-01`) } };
      } else if (filter === 'month') {
        console.log("Filtering by month...");
        // Filter by month (assuming 'date' field stores the enquiry date)
        const [year, month] = value.split('-'); // Value should be in 'YYYY-MM' format
  
        // Handle the case for December (month 12)
        let startDate = new Date(`${year}-${month}-01`);
        let endDate;
  
        if (month === '12') {
          // For December, the next month will be January of the next year
          endDate = new Date(`${parseInt(year) + 1}-01-01`);
        } else {
          // Otherwise, just go to the first day of the next month
          const nextMonth = String(parseInt(month) + 1).padStart(2, '0');
          endDate = new Date(`${year}-${nextMonth}-01`);
        }
  
        matchStage = { "date": { $gte: startDate, $lt: endDate } };
      } else {
        return res.status(400).json({ message: 'Invalid filter' });
      }
  
      // Run the aggregation pipeline with the match stage to filter data
      const regionLeaderboard = await Enquiry.aggregate([
        { $match: matchStage }, // Filter by the dynamic matchStage
        {
          $group: {
            _id: "$location", // Group by the 'location' field
            count: { $sum: 1 }, // Count the number of enquiries per region
          },
        },
        { $sort: { count: -1 } }, // Sort by count in descending order
      ]);
  
      console.log(regionLeaderboard);
      // Transform the data to match frontend expectations
      res.json(regionLeaderboard.map(entry => ({
        region: entry._id || "Unknown", // Handle cases where the location might be missing
        count: entry.count,
      })));
    } catch (error) {
      console.error(error);
      res.status(500).send(error.message);
    }
  });
  
  

  app.get('/api/categories', async (req, res) => {
    const { filter, value } = req.query;
  
    try {
      // Check if filter and value are provided
      if (!filter || !value) {
        return res.status(400).json({ message: 'Filter and value are required' });
      }
  
      // Prepare the match stage to filter based on year or month
      let matchStage = {};
  
      if (filter === 'year') {
        // Filter by year (assuming 'date' field stores the enquiry date)
        matchStage = { "date": { $gte: new Date(`${value}-01-01`), $lt: new Date(`${parseInt(value) + 1}-01-01`) } };
      } else if (filter === 'month') {
        console.log("Filtering by month...");
        // Filter by month (assuming 'date' field stores the enquiry date)
        const [year, month] = value.split('-'); // Value should be in 'YYYY-MM' format
  
        // Handle the case for December (month 12)
        let startDate = new Date(`${year}-${month}-01`);
        let endDate;
  
        if (month === '12') {
          // For December, the next month will be January of the next year
          endDate = new Date(`${parseInt(year) + 1}-01-01`);
        } else {
          // Otherwise, just go to the first day of the next month
          const nextMonth = String(parseInt(month) + 1).padStart(2, '0');
          endDate = new Date(`${year}-${nextMonth}-01`);
        }
  
        matchStage = { "date": { $gte: startDate, $lt: endDate } };
      } else {
        return res.status(400).json({ message: 'Invalid filter' });
      }
  
      // Run the aggregation pipeline with the match stage to filter data
      const categoryCounts = await Enquiry.aggregate([
        { $match: matchStage }, // Filter by the dynamic matchStage
        {
          $lookup: {
            from: "client_models", // Join with client_models collection
            localField: "interested_model", // Match 'interested_model' in Enquiry
            foreignField: "_id", // Match '_id' in client_models
            as: "model_info" // Alias for joined data
          }
        },
        { $unwind: "$model_info" }, // Flatten the model_info array
        { $unwind: "$model_info.category" }, // Flatten the category array
        {
          $group: {
            _id: "$model_info.category", // Group by category
            count: { $sum: 1 } // Count documents in each category
          }
        },
        { $sort: { count: -1 } } // Sort by count in descending order
      ]);
  
      // Transform the data for the radar chart
      res.json(
        categoryCounts.map(entry => ({
          category: entry._id || "Unknown", // Handle cases where category might be missing
          count: entry.count,
        }))
      );
    } catch (error) {
      console.error('Error fetching categories:', error.message);
      res.status(500).send(error.message);
    }
  });
  

  app.get('/api/sales-enquiries', async (req, res) => {
    const { filter, value } = req.query;

    try {
        // Ensure filter and value are provided
        if (!filter || !value) {
            return res.status(400).json({ message: 'Filter and value are required' });
        }

        // Prepare the match stage based on the filter (year or month)
        let matchStage = {};

        if (filter === 'year') {
            // Filter by year
            matchStage = { "date": { $gte: new Date(`${value}-01-01`), $lt: new Date(`${parseInt(value) + 1}-01-01`) } };
        } else if (filter === 'month') {
            // Filter by month
            const [year, month] = value.split('-'); // Expected format 'YYYY-MM'
            let startDate = new Date(`${year}-${month}-01`);
            let endDate;

            if (month === '12') {
                // For December, move to January of next year
                endDate = new Date(`${parseInt(year) + 1}-01-01`);
            } else {
                // For other months, just go to the next month's first day
                const nextMonth = String(parseInt(month) + 1).padStart(2, '0');
                endDate = new Date(`${year}-${nextMonth}-01`);
            }

            matchStage = { "date": { $gte: startDate, $lt: endDate } };
        } else {
            return res.status(400).json({ message: 'Invalid filter' });
        }

        // Run aggregation pipeline with the matchStage to filter data
        const salesEnquiriesData = await Enquiry.aggregate([
            { $match: matchStage }, // Apply filter based on the provided parameters
            {
                $match: {
                    interested_model: { $type: 'objectId' },
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
            {
                $lookup: {
                    from: "client_models",
                    localField: "_id",
                    foreignField: "_id",
                    as: "model_info",
                },
            },
            { $unwind: "$model_info" },
            {
                $project: {
                    model: "$model_info.model",
                    enquiry_count: 1,
                    converted_count: 1,
                },
            },
            { $sort: { enquiry_count: -1 } },
        ]);

        res.json(
            salesEnquiriesData.map(entry => ({
                model: entry.model || "Unknown",
                enquiry_count: entry.enquiry_count,
                converted_count: entry.converted_count,
            }))
        );
    } catch (error) {
        console.error('Error fetching sales vs enquiries data:', error.message);
        res.status(500).send(error.message);
    }
});



const PORT = 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
