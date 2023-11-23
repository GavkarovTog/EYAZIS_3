const express = require("express");
const app = express();
const multer = require("multer");
const { getReferateNN, getReferateSE } = require("./main.js");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const pdf = require("pdf-parse");

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, "uploads/");
    },
    filename: function (req, file, cb) {
        cb(
            null,
            file.filename + "-" + Date.now() + path.extname(file.originalname)
        );
    },
});

const upload = multer({ storage: storage });

app.post("/", upload.single("file"), async (req, res) => {
    const filePath = req.file.path;

    fs.readFile(filePath, async (err, data) => {
        if (err) {
            console.error(err);
            return res.status(500).send("Error reading file");
        }

        const content = await pdf(data);
        const text = content.text;
        let resultNN;
        let resultSE;
        try {
            resultSE = getReferateSE([text]);
            resultNN = await getReferateNN([text]);
        } catch (error) {
            console.error(error);
            return res.status(500).send("Error detecting language");
        }
        res.send({ resultSE: resultSE, resultNN: resultNN });
    });
});

app.listen(5000, () => {
    console.log("Server is running on http://localhost:5000");
});
