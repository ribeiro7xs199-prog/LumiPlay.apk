package com.lumiplay.app;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.CookieManager;
import android.widget.FrameLayout;
import android.content.Intent;
import android.net.Uri;

public class MainActivity extends Activity {

    private WebView webView;
    private FrameLayout container;
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private int oldSystemUi;

    private static final String HOME =
        "https://jolly-leaf-97de.ribeiro7xs199.workers.dev/";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        container = new FrameLayout(this);
        webView = new WebView(this);
        container.addView(webView);
        setContentView(container);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance()
            .setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(
                WebView view, WebResourceRequest request) {

                Uri uri = request.getUrl();
                String scheme = uri.getScheme();

                if ("https".equalsIgnoreCase(scheme)
                    || "http".equalsIgnoreCase(scheme)) {
                    return false;
                }

                try {
                    startActivity(new Intent(
                        Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(
                View view, CustomViewCallback callback) {

                if (fullscreenView != null) {
                    callback.onCustomViewHidden();
                    return;
                }

                fullscreenView = view;
                fullscreenCallback = callback;
                oldSystemUi = getWindow().getDecorView()
                    .getSystemUiVisibility();

                container.addView(view,
                    new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT));

                getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);

                getWindow().setFlags(
                    WindowManager.LayoutParams.FLAG_FULLSCREEN,
                    WindowManager.LayoutParams.FLAG_FULLSCREEN);
            }

            @Override
            public void onHideCustomView() {
                hideFullscreen();
            }
        });

        if (savedInstanceState == null) {
            webView.loadUrl(HOME);
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    private void hideFullscreen() {
        if (fullscreenView == null) return;

        container.removeView(fullscreenView);
        fullscreenView = null;

        getWindow().getDecorView()
            .setSystemUiVisibility(oldSystemUi);

        getWindow().clearFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN);

        if (fullscreenCallback != null) {
            fullscreenCallback.onCustomViewHidden();
            fullscreenCallback = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (fullscreenView != null) {
            hideFullscreen();
        } else if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
