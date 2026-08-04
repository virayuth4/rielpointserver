const axios = require('axios');
const cheerio = require('cheerio');

async function scrapeInstagramPost(url) {
    try {
      // Normalize URL
      const match = url.match(/\/p\/([^\/]+)/);
      if (!match) {
        throw new Error('Invalid Instagram post URL format.');
      }
      const shortcode = match[1];
      const apiUrl = `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`;
  
      const { data } = await axios.get(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept': 'application/json',
        },
      });
  
      const post = data.graphql?.shortcode_media;
      if (!post) {
        console.error('Post data not found.');
        return;
      }
  
      const caption = post.edge_media_to_caption?.edges[0]?.node.text || '';
      const displayUrl = post.display_url || '';
      const multipleImages = post.edge_sidecar_to_children?.edges?.map(edge => edge.node.display_url) || [];
  
      console.log('Caption:', caption);
      console.log('Main Image:', displayUrl);
      console.log('Carousel Images:', multipleImages);
  
    } catch (error) {
      console.error('Error scraping Instagram:', error.response?.status || error.message);
    }
  }
  
// Example usage:
scrapeInstagramPost('https://www.instagram.com/p/DI81OWHPk4K/?img_index=1/?__a=1&__d=dis');
