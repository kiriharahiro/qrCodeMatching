/**
 * =========================================================================
 * QRコード照合システム - Google Apps Script (GAS) テンプレート
 * =========================================================================
 * 
 * 【導入手順】
 * 1. 照合元のスプレッドシート（マスターデータがあるシート。シート名が「フォームの回答 1」であること）を開きます。
 * 2. 上部メニューの [拡張機能] > [Apps Script] をクリックします。
 * 3. エディタ内の既存のコードをすべて削除し、このコードを貼り付けます。
 * 4. エディタ右上の [デプロイ] > [新しいデプロイ] を選択します。
 * 5. 種類の選択（歯車アイコン）から「ウェブアプリ」を選択します。
 * 6. 設定を指定：
 *    - 次のユーザーとして実行: 「自分」（スプレッドシートのオーナー）
 *    - アクセスできるユーザー: 「全員」
 * 7. [デプロイ] を選択し、アクセスの承認とGoogle認証を行います。
 * 8. 発行された「ウェブアプリ URL」をコピーし、ブラウザアプリの設定画面に入力します。
 */

// マスターデータがあるシート名
const MASTER_SHEET_NAME = 'フォームの回答 1';

// ログを書き込むシート名（自動生成されます）
const LOG_SHEET_NAME = '作品受領Log';

/**
 * 照合とログ記録の共通処理ロジック
 */
function processMatching(requestData) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const isMatch = requestData.isMatch;
  const cleanKey = requestData.cleanKey; // クリーン化された照合コード (例: M83810)
  
  let userName = '不一致（対象外）';
  let imageUrl = '';
  
  // 一致している場合のみマスターシートの検索と更新を行う
  if (isMatch) {
    const masterSheet = ss.getSheetByName(MASTER_SHEET_NAME);
    if (!masterSheet) {
      throw new Error('マスターシート「' + MASTER_SHEET_NAME + '」が見つかりません。シート名を確認してください。');
    }
    
    const lastRow = masterSheet.getLastRow();
    let foundRow = -1;
    
    if (lastRow > 1) {
      // C列(QRコード列: 3列目)の値を一括取得
      const cValues = masterSheet.getRange(1, 3, lastRow, 1).getValues();
      
      // 該当のQRコード行を探索 (チェックデジット部分を除外して比較)
      for (let i = 0; i < cValues.length; i++) {
        const cellVal = cValues[i][0].toString();
        // C列の値からチェックデジット (ハイフン以降) を除外してトリム大文字化
        const cleanedCellVal = cellVal.split('-')[0].trim().toUpperCase();
        
        if (cleanedCellVal === cleanKey) {
          foundRow = i + 1; // 1-indexed 行番号
          break;
        }
      }
    }
    
    if (foundRow !== -1) {
      const now = new Date();
      const formattedJst = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
      
      // 1. N列 (14列目) 「お渡し完了時刻」を現在時刻でテキスト更新
      masterSheet.getRange(foundRow, 14).setValue(formattedJst);
      
      // 2. E列 (5列目) 「お名前」を取得
      userName = masterSheet.getRange(foundRow, 5).getValue().toString().trim() || '名前未登録';
      
      // 3. U列 (21列目) 「jpg画像URL」 を取得
      imageUrl = masterSheet.getRange(foundRow, 21).getValue().toString().trim();
    } else {
      userName = 'マッチしましたが、マスターに該当QRが見つかりません';
    }
  }
  
  // 4. 読取り記録ログを「作品受領Log」シートに書き込み
  let logSheet = ss.getSheetByName(LOG_SHEET_NAME);
  if (!logSheet) {
    logSheet = ss.insertSheet(LOG_SHEET_NAME);
    const headers = ['タイトル(お名前)', 'タイムスタンプ', '結果', '読取りデータ1(手持ちQR_A)', '読取りデータ2(完成品QR_B)', '端末名/担当者'];
    logSheet.getRange(1, 1, 1, headers.length)
            .setValues([headers])
            .setFontWeight('bold')
            .setBackground('#f1f5f9');
    logSheet.setFrozenRows(1);
  }
  
  const formattedTimestamp = Utilities.formatDate(new Date(requestData.timestamp), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
  const logRow = [
    isMatch ? userName : '（不一致のため無し）',
    formattedTimestamp,
    isMatch ? '一致' : '不一致',
    requestData.valA,
    requestData.valB,
    requestData.deviceName
  ];
  
  logSheet.appendRow(logRow);
  
  // 不一致行のカラーリング装飾
  const lastLogRow = logSheet.getLastRow();
  if (!isMatch) {
    logSheet.getRange(lastLogRow, 1, 1, logRow.length).setBackground('#fff1f2'); // 全体を薄い赤に
    logSheet.getRange(lastLogRow, 3).setFontColor('#e11d48').setFontWeight('bold'); // 結果を赤文字強調
  } else {
    logSheet.getRange(lastLogRow, 3).setFontColor('#059669').setFontWeight('bold'); // 結果を緑文字強調
  }
  
  return {
    status: 'success',
    name: userName,
    imageUrl: imageUrl
  };
}

/**
 * POSTリクエスト処理 (オフライン再同期などのバックグラウンド送信時に使用)
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (err) {
    return makeJsonResponse({
      status: 'error',
      message: '書き込みロックのタイムアウトが発生しました。'
    });
  }
  
  try {
    const requestData = JSON.parse(e.postData.contents);
    const result = processMatching(requestData);
    return makeJsonResponse(result);
  } catch (error) {
    return makeJsonResponse({
      status: 'error',
      message: 'GAS実行内部エラー: ' + error.toString()
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * GETリクエスト処理 (JSONP形式でリアルタイム照合結果を返す際に使用 - CORS回避用)
 */
function doGet(e) {
  const lock = LockService.getScriptLock();
  const callback = e.parameter.callback;
  
  try {
    lock.waitLock(10000);
  } catch (err) {
    return makeJsonpResponse(callback, {
      status: 'error',
      message: '書き込みロックのタイムアウトが発生しました。'
    });
  }
  
  try {
    const requestData = JSON.parse(e.parameter.data);
    const result = processMatching(requestData);
    return makeJsonpResponse(callback, result);
  } catch (error) {
    return makeJsonpResponse(callback, {
      status: 'error',
      message: 'GAS実行内部エラー: ' + error.toString()
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * CORS対応のJSONレスポンス出力ヘルパー
 */
function makeJsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
                       .setMimeType(ContentService.MimeType.JSON);
}

/**
 * JSONPレスポンス出力ヘルパー
 */
function makeJsonpResponse(callback, obj) {
  const responseText = callback + '(' + JSON.stringify(obj) + ')';
  return ContentService.createTextOutput(responseText)
                       .setMimeType(ContentService.MimeType.JAVASCRIPT);
}
