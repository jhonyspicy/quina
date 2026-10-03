import { useState } from "react";
import { renderSVG } from "uqr";

type Props = {
  tournamentId: string;
  remoteUrl: string;
};

/**
 * 開発用の準備画面。管理画面の代わりに、準備した大会へスタッフのスマホを接続するQRを表示する。
 * 表示し直しても大会は作り直さない。
 */
export function Setup({ tournamentId, remoteUrl }: Props) {
  const [copied, setCopied] = useState(false);
  const qr = `data:image/svg+xml;utf8,${encodeURIComponent(
    renderSVG(remoteUrl, { border: 2, whiteColor: "#ffffff", blackColor: "#000000" }),
  )}`;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(remoteUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <main className="screen">
      <h1>大会の準備ができました</h1>
      <section className="card setup">
        <p className="note">スタッフのスマホでこのQRを読み取ると、この大会のリモコンになります。</p>
        <img className="qr" src={qr} alt="リモコン接続用のQRコード" width={240} height={240} />
        {local && (
          <p className="error">
            この画面は {location.hostname} で開かれているため、QRのURLは他の端末から開けません。スマホで読み取るには、PCのIPアドレス（例: http://192.168.0.10:{location.port}）でこの画面を開き直してください。
          </p>
        )}
        <p className="url">{remoteUrl}</p>
        <div className="row">
          <button onClick={copy}>{copied ? "コピーしました" : "URLをコピー"}</button>
          <a className="button" href={remoteUrl}>
            この端末でリモコンを開く
          </a>
        </div>
        <p className="note small">大会ID: {tournamentId}</p>
      </section>
    </main>
  );
}
