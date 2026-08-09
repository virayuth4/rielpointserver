const axios = require('axios');

axios.post('http://127.0.0.1:3001/api/point-notification', {
    phoneNumber: "85512345678",
    points: 10,
    merchantName: "test"
}, {
    headers: { 'x-api-key': '20b9e121c8d9f0e97ed7b83b60424c3024aa8d82cd0dbf8de230eefa2b8215f1' }
})
.then(res => {
    console.log("STATUS:", res.status);
    console.log("DATA:", res.data);
})
.catch(err => {
    console.log("STATUS:", err.response?.status);
    console.log("DATA:", err.response?.data || err.message);
});