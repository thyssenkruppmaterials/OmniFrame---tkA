// Created and developed by Jai Singh
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { HeaderBar } from "@/components/header-bar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AboutPage } from "@/pages/about";
import { MasterPage } from "@/pages/master";
import { SettingsPage } from "@/pages/settings";

export function App() {
  return (
    <BrowserRouter>
      <TooltipProvider delayDuration={120}>
        <div className="flex h-full min-h-screen flex-col bg-background text-foreground">
          <HeaderBar />
          <Routes>
            <Route path="/" element={<MasterPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="*" element={<MasterPage />} />
          </Routes>
        </div>
      </TooltipProvider>
    </BrowserRouter>
  );
}

// Created and developed by Jai Singh
