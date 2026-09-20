import axios from 'axios';

async function test() {
  try {
    const res = await axios.post('http://localhost:3000/api/optimize-address', {
      customerAddress: 'lahore Sami ullah 0333-1234567 pso pump ke pa',
      customerName: '',
      customerPhone: '',
      customerCity: ''
    });
    console.log("Success:", res.data);
  } catch (err) {
    if (err.response) {
      console.error("API Error Status:", err.response.status);
      console.error("API Error Data:", err.response.data);
    } else {
      console.error("Fetch Error:", err.message);
    }
  }
}

test();
