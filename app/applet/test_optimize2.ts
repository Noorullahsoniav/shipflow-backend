const text1 = `Ali Raza
03460012345
Korangi No 2
Karachi`;

const text2 = "Name: Waqas, City: Karachi, Ph: 0347-4763055, Address: Main street";
const text3 = "Sami ullah 0333-1234567 pso pump ke pass, lahore";

function optimize(text) {
  let newPhone = '';
  let newCity = '';
  let newName = '';

  const phoneRegex = /(?:03|\+?92\s*3)[0-9\-\s]{9,12}/g;
  const phones = text.match(phoneRegex);
  if (phones && phones.length > 0) {
    let extracted = phones[0].replace(/[\-\s\+]/g, '');
    if (extracted.startsWith('92')) {
      extracted = '0' + extracted.substring(2);
    }
    if (!newPhone) newPhone = extracted;
    text = text.replace(phones[0], '');
  }

  const pakCities = [
    "Karachi", "Lahore", "Islamabad", "Rawalpindi", "Faisalabad", "Multan", "Peshawar", "Quetta", "Hyderabad", "Gujranwala", 
    "Sialkot", "Abbottabad", "Bahawalpur", "Sargodha", "Sukkur", "Swat", "Mardan", "Gujrat", "Jhang", "Sahiwal", 
    "Nawabshah", "Mianwali", "Mirpur", "Muzaffarabad", "Gilgit", "Skardu", "Chitral", "Jhelum", "Attock", "Kasur", 
    "Vehari", "Okara", "Bannu", "Kohat", "Dera Ismail Khan", "Dera Ghazi Khan", "Bhakkar", "Layyah", "Rajanpur", 
    "Muzaffargarh", "Rahim Yar Khan", "Ghotki", "Shikarpur", "Jacobabad", "Kashmore", "Larkana", "Qambar", "Dadu", 
    "Jamshoro", "Matiari", "Tando Allahyar", "Tando Muhammad Khan", "Badin", "Sujawal", "Thatta", "Malir", "Korangi", 
    "Keamari", "Central", "East", "West", "South", "Swabi", "Charsadda", "Nowshera", "Mansehra", "Haripur", "Karak",
    "کراچی", "لاہور", "اسلام آباد", "راولپنڈی", "فیصل آباد", "ملتان", "پشاور", "کوئٹہ", "حیدرآباد", "گوجرانوالہ", "سیالکوٹ", "سوات", "صوابی", "مردان"
  ];
  
  for (const city of pakCities) {
    const cityRegex = new RegExp(`(?<![a-zA-Z])(${city})(?![a-zA-Z])`, 'i');
    const match = text.match(cityRegex);
    if (match) {
      if (!newCity) newCity = match[0];
      text = text.replace(cityRegex, '');
      break;
    }
  }

  text = text.replace(/(?:Phone|Ph|Mob|Mobile|نمبر|فون|موبائل|Cell)\s*[:\-\.]?\s*(?=\b|,|$)/gi, '');
  text = text.replace(/(?:City|شہر)\s*[:\-\.]?\s*(?=\b|,|$)/gi, '');
  
  const nameMatch = text.match(/(?:Name|نام)\s*[:\-\.]*\s*([A-Za-z\s]+?)(?:[,\n]|$)/i);
  if (nameMatch && nameMatch[1].trim().length > 2) {
    if (!newName) newName = nameMatch[1].trim();
    text = text.replace(nameMatch[0], '');
  } else {
    // Try to extract first line/chunk if no Name: label
    const lines = text.split(/[,\n]/);
    if (lines.length > 0 && lines[0].trim().split(" ").length <= 4 && lines[0].trim().length > 2 && !/^[0-9]+$/.test(lines[0].trim())) {
      if (!newName) newName = lines[0].trim();
      text = text.replace(lines[0], '');
    }
  }

  let cleaned = text
    .replace(/(?:Address|پتہ)\s*[:\-\.]*/gi, '')
    .replace(/[*&%$!^()\[\]{}"]/g, '')
    .replace(/[\n\r]+/g, ', ')
    .replace(/,+|،+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
    
  cleaned = cleaned.replace(/^[\s,]+|[\s,]+$/g, '');
  cleaned = cleaned.replace(/\b[a-zA-Z]/g, (l) => l.toUpperCase());

  return { newName, newPhone, newCity, cleaned };
}

console.log(optimize(text1));
console.log(optimize(text2));
console.log(optimize(text3));
