import axios from 'axios';
async function test() {
  const trackingId = 'VPL11064672'; 
  const scrapeUrl = `http://localhost:3000/api/track/pakpost/${trackingId}`;
  try {
    const response = await axios.get(scrapeUrl);
    console.log(JSON.stringify(response.data, null, 2));
  } catch (err: any) {
    console.error(err.message);
  }
}
test();
