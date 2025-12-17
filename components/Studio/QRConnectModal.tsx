import React, { useState, useEffect } from 'react';
import { Smartphone, X, Link as LinkIcon, ExternalLink, Cloud, Globe, AlertTriangle, Wifi, Copy, ArrowRight } from 'lucide-react';

interface QRConnectModalProps {
  roomId: string;
  relayPort: string; // Deprecated but kept for interface compatibility
  onClose: () => void;
}

export const QRConnectModal: React.FC<QRConnectModalProps> = ({ roomId, onClose }) => {
  // Initialize URL safely
  const [baseUrl, setBaseUrl] = useState('');

  useEffect(() => {
    const href = window.location.href;
    // Only set default if it looks like a real network URL
    if (href && !href.startsWith('about:') && !href.startsWith('blob:') && !href.startsWith('data:')) {
         const clean = href.split('?')[0].replace(/\/$/, '');
         setBaseUrl(clean);
    }
  }, []);
  
  // Check protocols
  const isFile = baseUrl.startsWith('file:');
  const isInvalid = !baseUrl || baseUrl.startsWith('about:') || baseUrl.startsWith('blob:');

  // Construct the final Mobile URL for PeerJS mode
  const getMobileUrl = () => {
    let url = baseUrl.trim();
    if (!url) return '';

    // Ensure protocol exists (phones need http:// or https://)
    if (!url.startsWith('http') && !url.startsWith('https') && !url.startsWith('file')) {
        url = `https://${url}`;
    }

    const separator = url.includes('?') ? '&' : '?';
    // Append timestamp to prevent caching issues
    return `${url}${separator}mode=companion&room=${roomId}&t=${Date.now()}`;
  };

  const mobileUrl = getMobileUrl();
  const canShowQr = mobileUrl && !isFile && !isInvalid;
  
  const qrApiUrl = canShowQr 
    ? `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=10&data=${encodeURIComponent(mobileUrl)}`
    : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-aether-900 border border-aether-700 rounded-xl w-[700px] shadow-2xl p-6 relative max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white"><X size={20} /></button>
        
        <div className="text-center mb-6">
            <div className="w-12 h-12 bg-aether-800 rounded-full flex items-center justify-center mx-auto mb-3">
                <Smartphone className="text-aether-400" size={24} />
            </div>
            <h2 className="text-xl font-bold text-white">Connect Mobile Camera</h2>
            <p className="text-sm text-gray-400">Scan this code to link your phone wirelessly.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Left: Auto (QR) */}
            <div className="flex flex-col gap-4 border-r border-aether-800 pr-8">
                <h3 className="text-sm font-bold text-aether-300 uppercase tracking-wider text-center">Option 1: Scan QR</h3>
                
                <div className="flex flex-col items-center justify-start">
                    <div className="bg-white p-2 rounded-xl w-48 h-48 mb-3 shadow-lg relative bg-white">
                        {canShowQr ? (
                            <img src={qrApiUrl} alt="Scan QR" className="w-full h-full mix-blend-multiply" />
                        ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 text-xs text-center p-4 border border-dashed border-gray-300 rounded bg-gray-50">
                            <AlertTriangle size={24} className="mb-2 opacity-50"/>
                            {isFile ? "Cannot use file:// protocol" : "Please enter App URL"}
                            </div>
                        )}
                    </div>
                    
                    <div className="w-full space-y-2">
                         <div className="space-y-1">
                            <label className="text-[10px] font-bold text-gray-400 uppercase flex items-center gap-2">
                                <Globe size={10} /> App URL
                            </label>
                            <input 
                                type="text" 
                                value={baseUrl} 
                                onChange={(e) => setBaseUrl(e.target.value)} 
                                className={`w-full bg-black/30 border rounded p-1.5 text-xs text-white focus:outline-none ${isInvalid || isFile ? 'border-red-500' : 'border-aether-600'}`}
                                placeholder="https://..."
                            />
                         </div>

                         <div className="flex gap-2 pt-2">
                             <a 
                                href={canShowQr ? mobileUrl : undefined} 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded border text-xs font-medium transition-colors ${
                                    !canShowQr
                                    ? 'bg-gray-800 text-gray-500 border-gray-700 cursor-not-allowed' 
                                    : 'bg-aether-800 hover:bg-aether-700 text-white border-aether-600'
                                }`}
                                onClick={(e) => !canShowQr && e.preventDefault()}
                             >
                                 <ExternalLink size={14} /> Test Link
                             </a>

                             <button
                                onClick={() => {
                                    if (canShowQr) {
                                        // Open in new tab to avoid frame crashing
                                        window.open(mobileUrl, '_blank');
                                    }
                                }}
                                disabled={!canShowQr}
                                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded border text-xs font-bold transition-colors ${
                                    !canShowQr 
                                    ? 'bg-gray-800 text-gray-500 border-gray-700 cursor-not-allowed'
                                    : 'bg-gradient-to-r from-aether-600 to-fuchsia-600 text-white border-white/10 shadow-lg'
                                }`}
                             >
                                <Smartphone size={14} /> Launch App
                             </button>
                         </div>
                    </div>
                </div>
            </div>

            {/* Right: Manual */}
            <div className="flex flex-col gap-4">
                 <h3 className="text-sm font-bold text-fuchsia-300 uppercase tracking-wider text-center">Option 2: Manual Code</h3>
                 
                 <div className="space-y-4 text-sm text-gray-300">
                    <p>If the QR code fails to open the camera:</p>
                    <ol className="list-decimal list-inside space-y-2 text-gray-400 text-xs">
                        <li>Open this app on your phone manually.</li>
                        <li>Tap <span className="text-white font-bold">"Use Phone as Camera"</span> on the home screen.</li>
                        <li>Enter the code below:</li>
                    </ol>
                 </div>

                 <div className="bg-black/40 border border-aether-600 rounded-xl p-6 text-center space-y-2">
                     <p className="text-xs text-gray-500 uppercase tracking-wider font-bold">Connection Code</p>
                     <div className="text-3xl font-mono font-bold text-white tracking-[0.2em] select-all cursor-pointer hover:text-aether-400 transition-colors">
                         {roomId}
                     </div>
                 </div>

                 <div className="bg-aether-800/30 p-3 rounded-lg border border-aether-700/50 text-xs text-gray-400">
                    <p>
                        <strong>Powered by PeerJS Cloud:</strong> No manual server configuration required.
                    </p>
                 </div>
            </div>
        </div>

      </div>
    </div>
  );
};