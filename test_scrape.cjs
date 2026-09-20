const axios = require('axios');
axios.get('https://ep.gov.pk/emtts/EPTrack_Live.aspx?ArticleIDz=VPL11064692', {
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Accept": "text/html"
  }
}).then(res => {
  console.log(res.data);
}).catch(err => console.error(err.message));
