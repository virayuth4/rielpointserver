 function formatCityName(city) {
  console.log('city')
    // Use a regular expression to add a space before uppercase letters and capitalize the first letter
    return city
      .replace(/([a-z])([A-Z])/g, '$1 $2')  // Add space between lowercase and uppercase letters
      .replace(/\b\w/g, char => char.toUpperCase());  // Capitalize the first letter of each word
  }
  

function inverseFormatCityName(city) {
  return city.toLowerCase().replace(/\s+/g, '');
};
  
module.exports = {formatCityName, inverseFormatCityName}


