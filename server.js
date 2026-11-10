const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Render က သတ်မှတ်ပေးမယ့် Port ကို ယူသုံးခြင်း
const PORT = process.env.PORT || 3000;

app.use(express.json());

// App ကနေ ပုံလှမ်းပို့မယ့် လိပ်စာ (Route)
app.post('/api/remove-object', upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'mask', maxCount: 1 }
]), async (req, res) => {
    try {
        // Render Dashboard မှ ကျွန်တော်တို့ ထည့်သွင်းမည့် ဉာဏ်ရည်တု API Key ကို ယူခြင်း
        const apiKey = process.env.PIXEL_API_KEY;
        
        if (!apiKey) {
            return res.status(500).json({ error: "Server Error: API Key missing in backend configuration." });
        }

        if (!req.files || !req.files['image'] || !req.files['mask']) {
            return res.status(400).json({ error: "Missing image or mask file." });
        }

        // PixelAPI ဆီသို့ ထပ်ဆင့်ပို့ရန် Form Data တည်ဆောက်ခြင်း
        const formData = new FormData();
        formData.append('image', req.files['image'][0].buffer, {
            filename: 'image.jpg',
            contentType: req.files['image'][0].mimetype
        });
        formData.append('mask', req.files['mask'][0].buffer, {
            filename: 'mask.jpg',
            contentType: req.files['mask'][0].mimetype
        });

        // PixelAPI Server ဆီသို့ Backend အချင်းချင်း လှမ်းပို့ခြင်း
        const response = await axios.post('https://pixelapi.dev', formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${apiKey}`
            },
            responseType: 'arraybuffer' // ပုံအသစ်ကို binary အနေနဲ့ ပြန်ယူမည်
        });

        // ရလာတဲ့ ပုံအသစ်ကို App (Sketchware) ဆီ တိုက်ရိုက် ပြန်လည် ပေးပို့ခြင်း
        res.set('Content-Type', 'image/jpeg');
        res.send(response.data);

    } catch (error) {
        console.error(error.message);
        res.status(error.response?.status || 500).json({ 
            error: "AI Server Process Failed", 
            details: error.response?.data?.toString() || error.message 
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running beautifully on port ${PORT}`);
});
