import { isId } from "@quina/protocol";
import { randomId } from "@quina/realtime";

const KEY = "quina.remote.deviceId";

/**
 * このブラウザのリモコンとしての端末ID。大会ごとの識別番号を保つために使い、人の本人確認には使わない。
 * 保存できない環境では読み込みのたびに新しいIDになり、識別番号も変わる。
 */
export function loadDeviceId(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (isId(saved)) return saved;
    const id = randomId();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    return randomId();
  }
}
