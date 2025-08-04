require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const cron = require('node-cron');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const BNB_RPC_URL = process.env.BNB_RPC_URL || 'https://bsc-dataseed.binance.org/';
const MZLX_ADDRESS = process.env.MZLX_ADDRESS || '0x49F4a728BD98480E92dBfc6a82d595DA9d1F7b83';
const USDT_ADDRESS = process.env.USDT_ADDRESS || '0x55d398326f99059fF775485246999027B3197955';
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;

// Validate private key format
if (!ADMIN_PRIVATE_KEY || !/^[0-9a-fA-F]{64}$/.test(ADMIN_PRIVATE_KEY)) {
  console.error('ERROR: Invalid ADMIN_PRIVATE_KEY format in .env file');
  console.error('Private key should be 64 hexadecimal characters without 0x prefix');
  process.exit(1);
}

// Setup
const provider = new ethers.JsonRpcProvider(BNB_RPC_URL);
const adminWallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);

// ERC20 ABI
const ERC20_ABI = [
  "function transfer(address to, uint256 amount) public returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

const mzlxContract = new ethers.Contract(MZLX_ADDRESS, ERC20_ABI, adminWallet);
const usdtContract = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, provider);

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.post('/api/purchase', async (req, res) => {
  try {
    const { walletAddress, usdtAmount, mzlxAmount, txHash } = req.body;

    // Validate input
    if (!ethers.isAddress(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }
    if (isNaN(usdtAmount) || usdtAmount <= 0) {
      return res.status(400).json({ error: 'Invalid USDT amount' });
    }
    if (!txHash || !/^0x([A-Fa-f0-9]{64})$/.test(txHash)) {
      return res.status(400).json({ error: 'Invalid transaction hash' });
    }

    // Verify transaction
    const tx = await provider.getTransaction(txHash);
    if (!tx) return res.status(400).json({ error: 'Transaction not found' });

    const receipt = await tx.wait();
    if (receipt.status !== 1) {
      return res.status(400).json({ error: 'Transaction failed' });
    }

    // Verify it's a USDT transfer to our address
    if (tx.to.toLowerCase() !== USDT_ADDRESS.toLowerCase()) {
      return res.status(400).json({ error: 'Not a USDT transaction' });
    }

    // Send MZLx tokens
    const mzlxValue = ethers.parseUnits(mzlxAmount.toString(), await mzlxContract.decimals());
    const sendTx = await mzlxContract.transfer(walletAddress, mzlxValue);
    await sendTx.wait();

    res.json({
      success: true,
      message: 'MZLx tokens sent successfully',
      mzlxTxHash: sendTx.hash,
      mzlxAmount: mzlxAmount
    });

  } catch (error) {
    console.error('Purchase error:', error);
    res.status(500).json({ 
      error: error.message || 'Internal server error',
      details: error.reason || undefined
    });
  }
});

// Health Check Endpoint
app.get('/api/health', async (req, res) => {
  try {
    const balance = await mzlxContract.balanceOf(adminWallet.address);
    const decimals = await mzlxContract.decimals();
    const formattedBalance = ethers.formatUnits(balance, decimals);
    
    res.json({ 
      status: 'active',
      chainId: 56,
      adminWallet: adminWallet.address,
      mzlxBalance: formattedBalance
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
});

// Self-ping function to keep instance awake
function pingServer() {
  const baseUrl = `http://localhost:${PORT}`;
  const healthUrl = `${baseUrl}/api/health`;
  
  console.log(`[${new Date().toISOString()}] Pinging server to keep awake...`);
  
  http.get(healthUrl, (response) => {
    let data = '';
    response.on('data', (chunk) => data += chunk);
    response.on('end', () => {
      console.log(`[${new Date().toISOString()}] Ping successful: ${response.statusCode}`);
    });
  }).on('error', (err) => {
    console.error(`[${new Date().toISOString()}] Ping error: ${err.message}`);
  });
}

// Start server
const server = app.listen(PORT, () => {
  console.log(`MAZOL Token Sale Backend running on port ${PORT}`);
  console.log(`Admin Wallet: ${adminWallet.address}`);
  
  // Start cron job after server starts
  cron.schedule('*/5 * * * *', () => {
    console.log(`[${new Date().toISOString()}] Running keep-alive cron job`);
    pingServer();
  });
  
  // Initial ping
  pingServer();
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
