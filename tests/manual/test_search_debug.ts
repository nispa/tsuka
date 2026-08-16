async function debug() {
  const url = 'https://html.duckduckgo.com/html/?q=Node.js%2022';
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0'
    }
  });
  console.log("Status:", response.status);
  const html = await response.text();
  console.log("HTML length:", html.length);
  console.log("Contains web-result:", html.includes('web-result'));
  console.log("Contains result__snippet:", html.includes('result__snippet'));
  console.log("Contains results_links:", html.includes('results_links'));
  
  // Scrivi una parte dell'HTML in console
  const index = html.indexOf('class="result');
  if (index !== -1) {
    console.log("Snippet HTML nei pressi di 'class=\"result':");
    console.log(html.substring(index, index + 1000));
  } else {
    console.log("Impossibile trovare class=\"result, inizio HTML:");
    console.log(html.substring(0, 1000));
  }
}
debug().catch(console.error);
