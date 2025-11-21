import { searchCards, tileCardImages } from "./scryfall.ts";

/**
 * Test function that fetches random cards from FIN set and creates a tiled image
 */
async function testCardTiling() {
  try {
    console.log("Fetching cards from FIN set...");

    // Search for cards from the FIN set
    const allCards = await searchCards("set:fin");
    console.log(`Found ${allCards.length} cards in FIN set`);

    if (allCards.length === 0) {
      throw new Error("No cards found in FIN set");
    }

    // Select random number of cards between 5 and 15
    const numCards = Math.floor(Math.random() * 11) + 5; // 5-15 cards
    console.log(`Selecting ${numCards} random cards...`);

    // Shuffle and select random cards
    const shuffled = [...allCards].sort(() => Math.random() - 0.5);
    const selectedCards = shuffled.slice(0, numCards);

    console.log("Selected cards:", selectedCards.map((c) => c.name).join(", "));

    console.log("Creating tiled image...");
    const imageBlob = await tileCardImages(selectedCards, "small");

    // Convert blob to base64 data URI
    const arrayBuffer = await imageBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Convert to base64 without using spread operator to avoid stack overflow
    let binaryString = "";
    for (let i = 0; i < uint8Array.length; i++) {
      binaryString += String.fromCharCode(uint8Array[i]);
    }
    const base64 = btoa(binaryString);
    const dataUri = `data:image/png;base64,${base64}`;

    // Create a temporary HTML file to display the image
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>Card Tiling Test - ${numCards} FIN Cards</title>
    <style>
        body { 
            margin: 0; 
            padding: 20px; 
            background: #1a1a1a; 
            display: flex; 
            justify-content: center; 
            align-items: center; 
            min-height: 100vh;
        }
        img { 
            max-width: 100%; 
            max-height: 100vh; 
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        }
        h1 {
            color: white;
            text-align: center;
            font-family: Arial, sans-serif;
            position: absolute;
            top: 10px;
            left: 50%;
            transform: translateX(-50%);
        }
    </style>
</head>
<body>
    <h1>Card Tiling Test - ${numCards} Random FIN Cards</h1>
    <img src="${dataUri}" alt="Tiled Magic Cards" />
</body>
</html>`;

    // Write HTML to temporary file
    const tempFile = "/tmp/card-tiling-test.html";
    await Deno.writeTextFile(tempFile, htmlContent);

    console.log(`Opening image in browser...`);

    // Open in default browser
    const command = new Deno.Command("xdg-open", {
      args: [tempFile],
    });

    await command.output();

    console.log("Test completed successfully!");
  } catch (error) {
    console.error("Test failed:", error);
  }
}

// Run the test if this file is executed directly
if (import.meta.main) {
  await testCardTiling();
}
